import { mkdtemp, readdir, rm, utimes, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { metrics } from '../src/lib/metrics.js';
import { BLOCK_MS, blockNotice, blockYoutube, resetYoutubeBlock, restoreYoutubeBlock, youtubeBlockedUntil } from '../src/lib/music/block.js';
import { CACHE_MAX_BYTES, CACHE_TTL_MS, INFO_TTL_MS, MusicCache, planSweep, searchKey, type CacheFile } from '../src/lib/music/cache.js';
import { formatTime } from '../src/lib/time.js';

const ID = 'dQw4w9WgXcQ';
const DAY = 24 * 60 * 60_000;
const track = { id: ID, title: 'Never Gonna Give You Up', url: `https://www.youtube.com/watch?v=${ID}`, durationSeconds: 213, channel: 'Rick Astley' };
const age = (path: string, ms: number) => {
	const when = new Date(Date.now() - ms);
	return utimes(path, when, when);
};

describe('limpeza do cache', () => {
	const file = (path: string, kind: CacheFile['kind'], size: number, daysAgo: number): CacheFile => ({ path, kind, size, mtimeMs: Date.now() - daysAgo * DAY });

	it('trata como a mesma busca o texto com outras maiúsculas e espaços', () => {
		expect(searchKey('  Pink   Floyd TIME ')).toBe(searchKey('pink floyd time'));
		expect(searchKey('pink floyd time')).not.toBe(searchKey('pink floyd money'));
	});

	it('apaga o que passou do prazo de cada tipo', () => {
		const files = [
			file('audio-velho', 'audio', 10, 8),
			file('audio-novo', 'audio', 10, 6),
			file('info-velho', 'info', 1, 2 / 24),
			file('info-novo', 'info', 1, 0.5 / 24),
			file('busca-velha', 'search', 1, 8),
			file('parcial', 'partial', 5, 2 / 24)
		];
		expect(planSweep(files, Date.now()).sort()).toEqual(['audio-velho', 'busca-velha', 'info-velho', 'parcial']);
	});

	it('acima do teto, tira as faixas tocadas há mais tempo', () => {
		const gb = 1024 ** 3;
		const files = [file('a', 'audio', 4 * gb, 3), file('b', 'audio', 4 * gb, 1), file('c', 'audio', 4 * gb, 2), file('meta', 'meta', 1, 3)];
		expect(planSweep(files, Date.now(), CACHE_MAX_BYTES)).toEqual(['a']);
		expect(planSweep(files, Date.now(), 5 * gb).sort()).toEqual(['a', 'c']);
	});
});

describe('cache em disco', () => {
	let dir: string;
	let cache: MusicCache;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'severino-cache-'));
		cache = new MusicCache(dir);
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('lembra a busca e os dados da faixa, com o link remontado', async () => {
		expect(await cache.getSearch('pink floyd time')).toBeNull();
		await cache.setSearch('Pink Floyd Time', ID);
		await cache.setTrack(track);
		expect(await cache.getSearch('pink floyd   time')).toBe(ID);
		expect(await cache.getTrack(ID)).toEqual(track);
		expect(await cache.getTrack('curto')).toBeNull();
	});

	it('esquece o que não foi usado em 7 dias, e usar renova o prazo', async () => {
		await cache.setTrack(track);
		const meta = join(dir, 'meta', `${ID}.json`);
		await age(meta, CACHE_TTL_MS - DAY);
		expect(await cache.getTrack(ID)).toEqual(track);
		await age(meta, CACHE_TTL_MS + DAY);
		expect(await cache.getTrack(ID)).toBeNull();
	});

	it('recusa dados guardados que não passam na validação', async () => {
		await mkdir(join(dir, 'meta'), { recursive: true });
		await writeFile(join(dir, 'meta', `${ID}.json`), JSON.stringify({ id: ID, title: 'Longa', duration: 3 * 3600 }));
		expect(await cache.getTrack(ID)).toBeNull();
	});

	it('só reaproveita o JSON completo do pedido por 1 hora', async () => {
		expect(cache.freshInfo(ID)).toBeNull();
		await cache.setInfo(ID, { id: ID, formats: [] });
		expect(cache.freshInfo(ID)).toBe(join(dir, 'info', `${ID}.json`));
		await age(join(dir, 'info', `${ID}.json`), INFO_TTL_MS + 60_000);
		expect(cache.freshInfo(ID)).toBeNull();
	});

	it('esquece o JSON do pedido depois de um download que falhou, e só ele', async () => {
		await cache.setInfo(ID, { id: ID, formats: [] });
		await cache.setTrack(track);
		await cache.dropInfo(ID);
		expect(cache.freshInfo(ID)).toBeNull();
		expect(await cache.getTrack(ID)).toEqual(track);
		// Sem nada para apagar, não falha
		await cache.dropInfo(ID);
	});

	it('guarda a pausa do YouTube fora dos diretórios que a limpeza percorre', () => {
		expect(cache.blockFile).toBe(join(dir, 'youtube-block.json'));
	});

	it('guarda o áudio só quando o download termina bem', async () => {
		const discarded = cache.audioWriter(ID);
		discarded.stream.write('metade');
		discarded.discard();
		expect(cache.audio(ID)).toBeNull();

		const empty = cache.audioWriter(ID);
		empty.stream.end();
		expect(await empty.commit()).toBe(false);
		expect(cache.audio(ID)).toBeNull();

		const complete = cache.audioWriter(ID);
		complete.stream.end('áudio inteiro');
		expect(await complete.commit()).toBe(true);
		expect(cache.audio(ID)).toBe(join(dir, 'audio', ID));
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect((await readdir(join(dir, 'audio'))).filter((name) => name.endsWith('.partial'))).toEqual([]);
	});

	it('a limpeza apaga do disco o que venceu', async () => {
		await cache.setTrack(track);
		await cache.setSearch('pink floyd time', ID);
		await age(join(dir, 'meta', `${ID}.json`), CACHE_TTL_MS + DAY);
		expect(await cache.sweep()).toMatchObject({ removed: 1 });
		expect(await readdir(join(dir, 'meta'))).toEqual([]);
		expect(await cache.getSearch('pink floyd time')).toBe(ID);
	});
});

describe('pausa do YouTube', () => {
	afterEach(() => resetYoutubeBlock());

	it('dura 1 hora e diz até quando', () => {
		const now = new Date('2026-10-14T14:52:00Z').getTime();
		expect(youtubeBlockedUntil(now)).toBeNull();
		expect(blockNotice(now)).toBe('');

		expect(blockYoutube(now).getTime()).toBe(now + BLOCK_MS);
		expect(metrics.musicYoutubeBlocked).toBe(1);
		expect(youtubeBlockedUntil(now + BLOCK_MS - 1)).not.toBeNull();
		expect(youtubeBlockedUntil(now + BLOCK_MS)).toBeNull();
		expect(blockNotice(now)).toBe('Até 12:52, só toco o que já está no cache.');
	});

	it('um novo bloqueio estica a pausa, nunca encurta', () => {
		const now = Date.now();
		blockYoutube(now);
		expect(blockYoutube(now - 10 * 60_000).getTime()).toBe(now + BLOCK_MS);
		expect(blockYoutube(now + 10 * 60_000).getTime()).toBe(now + 10 * 60_000 + BLOCK_MS);
	});

	describe('gravada em disco', () => {
		let dir: string;
		let file: string;
		beforeEach(async () => {
			dir = await mkdtemp(join(tmpdir(), 'severino-pausa-'));
			file = join(dir, 'youtube-block.json');
		});
		afterEach(() => rm(dir, { recursive: true, force: true }));

		it('sobrevive a um reinício', () => {
			const now = Date.now();
			expect(restoreYoutubeBlock(file, now)).toBeNull();
			const until = blockYoutube(now);

			// O reinício apaga a memória, não o arquivo
			resetYoutubeBlock();
			expect(youtubeBlockedUntil(now)).toBeNull();
			expect(restoreYoutubeBlock(file, now + 10 * 60_000)).toEqual(until);
			expect(youtubeBlockedUntil(now + 10 * 60_000)).toEqual(until);
			expect(metrics.musicYoutubeBlocked).toBe(1);
		});

		it('ignora pausa vencida, arquivo estragado e prazo além de 1 hora', async () => {
			const now = Date.now();
			await writeFile(file, JSON.stringify({ until: now - 1 }));
			expect(restoreYoutubeBlock(file, now)).toBeNull();

			await writeFile(file, '{"until":');
			expect(restoreYoutubeBlock(file, now)).toBeNull();
			await writeFile(file, JSON.stringify({ until: 'amanhã' }));
			expect(restoreYoutubeBlock(file, now)).toBeNull();
			expect(metrics.musicYoutubeBlocked).toBe(0);

			await writeFile(file, JSON.stringify({ until: now + 30 * DAY }));
			expect(restoreYoutubeBlock(file, now)?.getTime()).toBe(now + BLOCK_MS);
		});

		it('sem onde gravar, a pausa vale em memória', async () => {
			const now = Date.now();
			await writeFile(file, '');
			// O "diretório" da pausa é um arquivo: gravar falha
			restoreYoutubeBlock(join(file, 'youtube-block.json'), now);
			expect(blockYoutube(now).getTime()).toBe(now + BLOCK_MS);
			expect(youtubeBlockedUntil(now)).not.toBeNull();
		});
	});

	it('escreve a hora em Brasília', () => {
		expect(formatTime(new Date('2026-10-14T14:52:00Z'))).toBe('11:52');
	});
});
