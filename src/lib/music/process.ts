import { spawn, type ChildProcess } from 'node:child_process';
import { PassThrough, type Readable } from 'node:stream';
import { container } from '@sapphire/framework';
import { config } from '../../config.js';
import { metrics } from '../metrics.js';
import { Limiter } from './limiter.js';
import { FFMPEG_ARGS, RESOLVE_TIMEOUT_MS, classifyFailure, parseResolved, resolveArgs, streamArgs, type ResolveResult, type YtDlpFailure } from './ytdlp.js';

const STDERR_TAIL_BYTES = 4 * 1024;
const MAX_JSON_BYTES = 10 * 1024 * 1024;
const KILL_GRACE_MS = 2_000;

// Cada resolução abre um yt-dlp e um Node para os desafios do YouTube: uma por vez, até 5 na espera
const resolutions = new Limiter(1, 5);

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

export type ResolveOutcome = ResolveResult | { ok: false; reason: YtDlpFailure | 'busy' };

/** Resolve um pedido com `yt-dlp -J`. Com a espera cheia, devolve busy sem abrir processo. */
export async function resolveTrack(target: string): Promise<ResolveOutcome> {
	return (await resolutions.run(() => runResolve(target))) ?? { ok: false, reason: 'busy' };
}

async function runResolve(target: string): Promise<ResolveOutcome> {
	const run = start(config.YTDLP_PATH, resolveArgs(target), 'ignore');
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
			return parseResolved(JSON.parse(Buffer.concat(chunks).toString('utf8')));
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

/** A regra única de contagem: bot-check e failure contam; unavailable e age são do vídeo, não nossos. */
export function recordFailure(reason: YtDlpFailure): void {
	if (reason === 'bot-check') metrics.musicBotChecks++;
	else if (reason === 'failure') metrics.musicFailures++;
}

export interface AudioHandle {
	stream: Readable;
	/** null quando os dois processos terminaram bem ou foram mortos por nós; senão, o tipo da falha. */
	finished: Promise<YtDlpFailure | null>;
	kill(): void;
}

/** Baixa a faixa com o yt-dlp e a converte em Ogg/Opus com o ffmpeg, que é o que o Discord toca. */
export function openAudio(url: string): AudioHandle {
	const download = start(config.YTDLP_PATH, streamArgs(url), 'ignore');
	const encoder = start('ffmpeg', FFMPEG_ARGS, 'pipe');
	// Guarda uns 40 MiB (escrita + leitura), a faixa inteira dentro do limite de 30 min: o yt-dlp baixa em segundos
	const buffer = new PassThrough({ highWaterMark: 20 * 1024 * 1024 });
	download.child.stdout!.pipe(buffer).pipe(encoder.child.stdin!);
	// EPIPE quando o ffmpeg morre primeiro; o resultado sai de `finished`
	encoder.child.stdin!.on('error', () => undefined);

	const killedByUs = new Set<ChildProcess>();
	let killed = false;
	const kill = () => {
		if (killed) return;
		killed = true;
		// Quem já saiu sozinho guarda o próprio resultado: uma falha que chegou antes do Idle não é apagada
		const alive = [download.child, encoder.child].filter(isAlive);
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

	const failedOnItsOwn = (run: Run, result: { code: number | null; spawnError: Error | null }) =>
		!killedByUs.has(run.child) && (result.spawnError !== null || result.code !== 0);

	const finished = Promise.all([download.closed, encoder.closed]).then(([downloaded, encoded]) => {
		let failure: YtDlpFailure | null = null;
		let detail = '';
		if (failedOnItsOwn(download, downloaded)) {
			failure = downloaded.spawnError ? 'failure' : classifyFailure(download.stderr());
			detail = downloaded.spawnError?.message ?? lastLine(download.stderr());
		} else if (failedOnItsOwn(encoder, encoded)) {
			failure = 'failure';
			detail = encoded.spawnError?.message ?? lastLine(encoder.stderr());
		}
		if (failure) container.logger.warn(`[música] falha (${failure}) em ${new URL(url).searchParams.get('v') ?? url}: ${detail}`);
		return failure;
	});

	return { stream: encoder.child.stdout!, finished, kill };
}
