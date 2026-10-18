import { spawn, type ChildProcess } from 'node:child_process';
import { createReadStream, type ReadStream } from 'node:fs';
import { PassThrough, type Readable } from 'node:stream';
import { container } from '@sapphire/framework';
import { config } from '../../config.js';
import { metrics } from '../metrics.js';
import { blockYoutube, restoreYoutubeBlock, youtubeBlockedUntil } from './block.js';
import { MusicCache, type CachedTrack } from './cache.js';
import { Limiter } from './limiter.js';
import type { Track } from './queue.js';
import {
	DEFAULT_YTDLP_CACHE,
	FFMPEG_ARGS,
	RESOLVE_TIMEOUT_MS,
	classifyFailure,
	loadInfoArgs,
	parseResolved,
	resolveArgs,
	resolvedEntry,
	streamArgs,
	type Info,
	type ResolveResult,
	type YtDlpFailure,
	type YtDlpOptions
} from './ytdlp.js';

const STDERR_TAIL_BYTES = 4 * 1024;
const MAX_JSON_BYTES = 10 * 1024 * 1024;
const KILL_GRACE_MS = 2_000;

// Cada resolução abre um yt-dlp e um Node para os desafios do YouTube: uma por vez, até 5 na espera
const resolutions = new Limiter(1, 5);

/** O cache em disco, quando MUSIC_CACHE_DIR está definido (no Docker, sempre). */
export const musicCache = config.MUSIC_CACHE_DIR ? new MusicCache(config.MUSIC_CACHE_DIR) : null;
// Com o cache em disco, os scripts do player do YouTube também sobrevivem a reinícios: menos chamadas a ele
const ytDlp: YtDlpOptions = { cacheDir: musicCache?.ytDlpDir ?? DEFAULT_YTDLP_CACHE, forceIpv6: config.YTDLP_FORCE_IPV6 };

/** No boot: retoma a pausa do YouTube gravada no cache, se ela ainda vale. Sem cache, a pausa fica só em memória. */
export function restoreYoutubePause(): Date | null {
	return musicCache ? restoreYoutubeBlock(musicCache.blockFile) : null;
}

interface Run {
	child: ChildProcess;
	/** Os últimos 4 KB do stderr, para classificar a falha e para o log. */
	stderr(): string;
	/** Resolve quando o processo terminou e fechou a saída; spawnError quando ele nem chegou a rodar. */
	closed: Promise<{ code: number | null; spawnError: Error | null }>;
}

/**
 * Cria o processo sem shell e num grupo próprio, para que o sinal alcance também os filhos dele
 * (o Node que o yt-dlp abre para os desafios do YouTube).
 */
function start(command: string, args: string[], stdin: 'ignore' | 'pipe'): Run {
	const child = spawn(command, args, { stdio: [stdin, 'pipe', 'pipe'], detached: true });
	let tail = '';
	child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
		tail = (tail + chunk).slice(-STDERR_TAIL_BYTES);
	});

	const closed = new Promise<{ code: number | null; spawnError: Error | null }>((resolve) => {
		let spawnError: Error | null = null;
		child.once('error', (error) => {
			spawnError = error;
			if (child.pid === undefined) resolve({ code: null, spawnError });
		});
		child.once('close', (code) => resolve({ code, spawnError }));
	});
	return { child, stderr: () => tail, closed };
}

const isAlive = (child: ChildProcess) => child.pid !== undefined && child.exitCode === null && child.signalCode === null;

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
	if (child.pid === undefined) return;
	try {
		process.kill(-child.pid, signal);
	} catch {
		// O grupo já terminou
	}
}

function lastLine(text: string): string {
	return text.trim().split('\n').at(-1)?.trim() || '(sem stderr)';
}

export type ResolveOutcome = ResolveResult | { ok: false; reason: YtDlpFailure | 'busy' | 'blocked' };

/** O que o /musica tocar pede: um vídeo já validado pelo parseQuery ou um texto de busca. */
export type ResolveQuery = { kind: 'video'; id: string; url: string } | { kind: 'search'; text: string };

/**
 * Resolve um pedido. Primeiro o cache, sem tocar no YouTube; depois o `yt-dlp -J`, uma resolução por vez,
 * a não ser que o YouTube esteja em pausa. Com a espera cheia, devolve busy sem abrir processo.
 */
export async function resolveTrack(query: ResolveQuery): Promise<ResolveOutcome> {
	const cached = await fromCache(query);
	if (cached) return { ok: true, track: cached };
	if (youtubeBlockedUntil()) return { ok: false, reason: 'blocked' };
	return (await resolutions.run(() => runResolve(query))) ?? { ok: false, reason: 'busy' };
}

async function fromCache(query: ResolveQuery): Promise<CachedTrack | null> {
	if (!musicCache) return null;
	const id = query.kind === 'video' ? query.id : await musicCache.getSearch(query.text);
	return id ? musicCache.getTrack(id) : null;
}

/** Guarda o pedido: a busca, os dados da faixa e o JSON completo, que a hora de tocar reaproveita. */
async function remember(query: ResolveQuery, track: CachedTrack, info: Info): Promise<void> {
	if (!musicCache) return;
	try {
		await Promise.all([
			musicCache.setTrack(track),
			musicCache.setInfo(track.id, info),
			query.kind === 'search' ? musicCache.setSearch(query.text, track.id) : Promise.resolve()
		]);
	} catch (error) {
		container.logger.warn(`[música] Não consegui gravar ${track.id} no cache:`, error);
	}
}

async function runResolve(query: ResolveQuery): Promise<ResolveOutcome> {
	const target = query.kind === 'video' ? query.url : `ytsearch1:${query.text}`;
	const run = start(config.YTDLP_PATH, resolveArgs(target, ytDlp), 'ignore');
	const chunks: Buffer[] = [];
	let size = 0;
	let problem: string | null = null;
	const stop = (reason: string) => {
		problem ??= reason;
		signalGroup(run.child, 'SIGKILL');
	};

	// O prazo conta do início do processo, não da espera na fila de resoluções
	const timer = setTimeout(() => stop(`passou de ${RESOLVE_TIMEOUT_MS / 1000} s`), RESOLVE_TIMEOUT_MS);
	run.child.stdout?.on('data', (chunk: Buffer) => {
		size += chunk.length;
		if (size > MAX_JSON_BYTES) stop('o JSON passou de 10 MB');
		else chunks.push(chunk);
	});
	const { code, spawnError } = await run.closed;
	clearTimeout(timer);

	let outcome: ResolveOutcome;
	if (spawnError || problem) {
		outcome = { ok: false, reason: 'failure' };
		problem = spawnError ? spawnError.message : problem;
	} else if (code === 0) {
		try {
			const json: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			const result = parseResolved(json);
			const info = resolvedEntry(json);
			if (result.ok && info) await remember(query, result.track, info);
			return result;
		} catch (error) {
			outcome = { ok: false, reason: 'failure' };
			problem = `JSON inválido: ${error instanceof Error ? error.message : String(error)}`;
		}
	} else {
		outcome = { ok: false, reason: classifyFailure(run.stderr()) };
		problem = lastLine(run.stderr());
	}

	container.logger.warn(`[música] falha (${outcome.reason}) ao resolver ${target}: ${problem}`);
	return outcome;
}

/**
 * A regra única de contagem: bot-check e failure contam; unavailable e age são do vídeo, não nossos.
 * Um bot-check também põe o YouTube em pausa por 1 hora.
 */
export function recordFailure(reason: YtDlpFailure): void {
	if (reason === 'bot-check') {
		metrics.musicBotChecks++;
		const until = blockYoutube();
		container.logger.warn(`[música] YouTube em pausa até ${until.toISOString()}: até lá, só toca o que está no cache`);
	} else if (reason === 'failure') {
		metrics.musicFailures++;
	}
}

/** Se a faixa toca sem o YouTube, direto do cache. */
export function hasCachedAudio(id: string): boolean {
	return Boolean(musicCache?.audio(id));
}

/** Apaga o que venceu no cache e mantém o áudio abaixo do teto. */
export async function sweepMusicCache(): Promise<void> {
	if (!musicCache) return;
	const { removed, bytes } = await musicCache.sweep();
	if (removed > 0) container.logger.info(`[música] cache: ${removed} arquivo(s) vencido(s) apagado(s), ${(bytes / 1024 ** 2).toFixed(1)} MiB`);
}

export interface AudioHandle {
	stream: Readable;
	/** null quando a fonte e o ffmpeg terminaram bem ou foram mortos por nós; senão, o tipo da falha. */
	finished: Promise<YtDlpFailure | null>;
	kill(): void;
}

interface SourceResult {
	failure: YtDlpFailure | null;
	detail: string;
}

/**
 * Converte a faixa em Ogg/Opus com o ffmpeg, que é o que o Discord toca. O áudio vem do cache, quando a
 * faixa já tocou; senão, do yt-dlp, que reaproveita a extração do pedido se ela for recente. O download é
 * gravado no cache enquanto toca.
 */
export function openAudio(track: Pick<Track, 'id' | 'url'>): AudioHandle {
	const encoder = start('ffmpeg', FFMPEG_ARGS, 'pipe');
	// Guarda uns 40 MiB (escrita + leitura), a faixa inteira dentro do limite de 30 min: o yt-dlp baixa em segundos
	const buffer = new PassThrough({ highWaterMark: 20 * 1024 * 1024 });
	buffer.pipe(encoder.child.stdin!);
	// EPIPE quando o ffmpeg morre primeiro; o resultado sai de `finished`
	encoder.child.stdin!.on('error', () => undefined);

	const killedByUs = new Set<ChildProcess>();
	let file: ReadStream | null = null;
	let download: Run | null = null;
	let source: Promise<SourceResult>;

	const cachedPath = musicCache?.audio(track.id) ?? null;
	if (cachedPath) {
		metrics.musicCacheHits++;
		const stream = createReadStream(cachedPath);
		file = stream;
		stream.pipe(buffer);
		source = new Promise((resolve) => {
			stream.once('error', (error) => {
				buffer.end();
				resolve({ failure: 'failure', detail: `cache: ${error.message}` });
			});
			stream.once('close', () => resolve({ failure: null, detail: '' }));
		});
	} else {
		const info = musicCache?.freshInfo(track.id) ?? null;
		const run = start(config.YTDLP_PATH, info ? loadInfoArgs(info, ytDlp) : streamArgs(track.url, ytDlp), 'ignore');
		download = run;
		const writer = musicCache?.audioWriter(track.id) ?? null;
		run.child.stdout!.pipe(buffer);
		if (writer) run.child.stdout!.pipe(writer.stream);
		source = run.closed.then(async ({ code, spawnError }): Promise<SourceResult> => {
			if (killedByUs.has(run.child)) {
				writer?.discard();
				return { failure: null, detail: '' };
			}
			if (spawnError || code !== 0) {
				writer?.discard();
				// Com o mesmo JSON, a nova tentativa pediria os mesmos links recusados
				if (info) void musicCache?.dropInfo(track.id).catch(() => undefined);
				return { failure: spawnError ? 'failure' : classifyFailure(run.stderr()), detail: spawnError?.message ?? lastLine(run.stderr()) };
			}
			if (writer && !(await writer.commit().catch(() => false))) container.logger.warn(`[música] Não consegui guardar o áudio de ${track.id} no cache`);
			return { failure: null, detail: '' };
		});
	}

	let killed = false;
	const kill = () => {
		if (killed) return;
		killed = true;
		file?.destroy();
		// Quem já saiu sozinho guarda o próprio resultado: uma falha que chegou antes do Idle não é apagada
		const alive = [download?.child, encoder.child].filter((child): child is ChildProcess => child !== undefined && isAlive(child));
		for (const child of alive) {
			killedByUs.add(child);
			signalGroup(child, 'SIGTERM');
		}
		if (alive.length > 0) {
			setTimeout(() => {
				for (const child of alive) if (isAlive(child)) signalGroup(child, 'SIGKILL');
			}, KILL_GRACE_MS).unref();
		}
	};

	const finished = Promise.all([source, encoder.closed]).then(([fetched, encoded]) => {
		let { failure, detail } = fetched;
		if (!failure && !killedByUs.has(encoder.child) && (encoded.spawnError !== null || encoded.code !== 0)) {
			failure = 'failure';
			detail = encoded.spawnError?.message ?? lastLine(encoder.stderr());
		}
		if (failure) container.logger.warn(`[música] falha (${failure}) em ${track.id}: ${detail}`);
		return failure;
	});

	return { stream: encoder.child.stdout!, finished, kill };
}
