import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, statSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { VIDEO_ID } from './query.js';
import type { Track } from './queue.js';
import { parseResolved, type Info } from './ytdlp.js';

/** Áudio, busca e dados da faixa valem 7 dias desde o último uso. */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60_000;
/** O JSON completo do pedido só serve enquanto os links de áudio do YouTube valem, que é algumas horas. */
export const INFO_TTL_MS = 60 * 60_000;
/** Teto do áudio guardado; passando dele, saem as faixas tocadas há mais tempo. */
export const CACHE_MAX_BYTES = 10 * 1024 ** 3;
/** Sobra de download interrompido (bot reiniciou no meio). */
const PARTIAL_TTL_MS = 60 * 60_000;

export type CachedTrack = Omit<Track, 'requestedBy'>;
type Kind = 'audio' | 'info' | 'meta' | 'search';
const KINDS: Kind[] = ['audio', 'info', 'meta', 'search'];
const TTL: Record<Kind | 'partial', number> = {
	audio: CACHE_TTL_MS,
	meta: CACHE_TTL_MS,
	search: CACHE_TTL_MS,
	info: INFO_TTL_MS,
	partial: PARTIAL_TTL_MS
};

export interface CacheFile {
	path: string;
	kind: Kind | 'partial';
	size: number;
	mtimeMs: number;
}

/** Chave da busca: o mesmo texto com outras maiúsculas ou espaços cai no mesmo resultado. */
export function searchKey(text: string): string {
	return createHash('sha256').update(text.trim().toLowerCase().replace(/\s+/g, ' ')).digest('hex');
}

/** O que a limpeza apaga: o que passou do prazo e, se o áudio passar do teto, as faixas tocadas há mais tempo. */
export function planSweep(files: readonly CacheFile[], now: number, maxBytes = CACHE_MAX_BYTES): string[] {
	const removed = new Set(files.filter((file) => now - file.mtimeMs > TTL[file.kind]).map((file) => file.path));
	const audio = files.filter((file) => file.kind === 'audio' && !removed.has(file.path)).sort((a, b) => a.mtimeMs - b.mtimeMs);
	let total = audio.reduce((sum, file) => sum + file.size, 0);
	for (const file of audio) {
		if (total <= maxBytes) break;
		removed.add(file.path);
		total -= file.size;
	}
	return [...removed];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const touch = (path: string) => {
	const now = new Date();
	return utimes(path, now, now).catch(() => undefined);
};

export interface AudioWriter {
	stream: Writable;
	/** Vira cache só se o download terminou bem e algo foi gravado; senão, descarta. */
	commit(): Promise<boolean>;
	discard(): void;
}

/**
 * Cache em disco da música: o áudio como veio do YouTube, o resultado das buscas, os dados da faixa e o
 * JSON completo do pedido (para tocar sem extrair de novo). Ler renova o prazo; gravar é atômico.
 */
export class MusicCache {
	public readonly ytDlpDir: string;
	private readonly dir: string;

	public constructor(dir: string) {
		this.dir = dir;
		this.ytDlpDir = join(dir, 'yt-dlp');
	}

	private path(kind: Kind, name: string): string {
		return join(this.dir, kind, name);
	}

	private async writeJson(path: string, value: unknown): Promise<void> {
		await mkdir(dirname(path), { recursive: true });
		const partial = `${path}.${process.pid}.${Date.now()}.partial`;
		await writeFile(partial, JSON.stringify(value));
		await rename(partial, path);
	}

	private async readJson(path: string, ttlMs: number): Promise<unknown> {
		try {
			if (Date.now() - (await stat(path)).mtimeMs > ttlMs) return null;
			const value: unknown = JSON.parse(await readFile(path, 'utf8'));
			await touch(path);
			return value;
		} catch {
			return null;
		}
	}

	public async getSearch(text: string): Promise<string | null> {
		const value = await this.readJson(this.path('search', `${searchKey(text)}.json`), CACHE_TTL_MS);
		const id = isRecord(value) ? value.id : null;
		return typeof id === 'string' && VIDEO_ID.test(id) ? id : null;
	}

	public setSearch(text: string, id: string): Promise<void> {
		return this.writeJson(this.path('search', `${searchKey(text)}.json`), { id });
	}

	/** Os dados da faixa, revalidados como um JSON do yt-dlp (ID, ao vivo, duração). */
	public async getTrack(id: string): Promise<CachedTrack | null> {
		if (!VIDEO_ID.test(id)) return null;
		const parsed = parseResolved(await this.readJson(this.path('meta', `${id}.json`), CACHE_TTL_MS));
		return parsed.ok && parsed.track.id === id ? parsed.track : null;
	}

	public setTrack(track: CachedTrack): Promise<void> {
		return this.writeJson(this.path('meta', `${track.id}.json`), {
			id: track.id,
			title: track.title,
			duration: track.durationSeconds,
			channel: track.channel
		});
	}

	public setInfo(id: string, info: Info): Promise<void> {
		return this.writeJson(this.path('info', `${id}.json`), info);
	}

	/** O JSON completo do pedido, se ainda for recente. Síncrono: é uma consulta só, na hora de começar a faixa. */
	public freshInfo(id: string): string | null {
		const path = this.path('info', `${id}.json`);
		try {
			return VIDEO_ID.test(id) && Date.now() - statSync(path).mtimeMs <= INFO_TTL_MS ? path : null;
		} catch {
			return null;
		}
	}

	/** O áudio guardado, renovando o prazo; null se não houver. Síncrono pelo mesmo motivo do freshInfo. */
	public audio(id: string): string | null {
		if (!VIDEO_ID.test(id)) return null;
		const path = this.path('audio', id);
		try {
			const info = statSync(path);
			if (info.size === 0 || Date.now() - info.mtimeMs > CACHE_TTL_MS) return null;
		} catch {
			return null;
		}
		void touch(path);
		return path;
	}

	/** Recebe o download enquanto ele toca, num arquivo à parte que só vira cache no commit. */
	public audioWriter(id: string): AudioWriter {
		const path = this.path('audio', id);
		mkdirSync(dirname(path), { recursive: true });
		const partial = `${path}.${process.pid}.${Date.now()}.partial`;
		const stream = createWriteStream(partial);
		let failed = false;
		stream.on('error', () => {
			failed = true;
		});
		const discard = () => {
			stream.destroy();
			void rm(partial, { force: true });
		};
		const commit = async () => {
			try {
				await finished(stream);
			} catch {
				failed = true;
			}
			if (failed || stream.bytesWritten === 0) {
				discard();
				return false;
			}
			await rename(partial, path);
			return true;
		};
		return { stream, commit, discard };
	}

	/** Apaga o que venceu e mantém o áudio abaixo do teto. Roda no boot e de hora em hora. */
	public async sweep(now = Date.now()): Promise<{ removed: number; bytes: number }> {
		const files: CacheFile[] = [];
		for (const kind of KINDS) {
			const names = await readdir(join(this.dir, kind)).catch(() => [] as string[]);
			for (const name of names) {
				const path = join(this.dir, kind, name);
				const info = await stat(path).catch(() => null);
				if (info?.isFile()) files.push({ path, kind: name.endsWith('.partial') ? 'partial' : kind, size: info.size, mtimeMs: info.mtimeMs });
			}
		}

		const removed = new Set(planSweep(files, now));
		let bytes = 0;
		for (const file of files) {
			if (!removed.has(file.path)) continue;
			await rm(file.path, { force: true });
			bytes += file.size;
		}
		return { removed: removed.size, bytes };
	}
}
