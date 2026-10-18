import { describe, expect, it } from 'vitest';
import { formatTrackTime } from '../src/lib/format.js';
import { Limiter } from '../src/lib/music/limiter.js';
import { parseQuery } from '../src/lib/music/query.js';
import { MAX_QUEUE, TrackQueue, type Track } from '../src/lib/music/queue.js';
import { MAX_TRACK_SECONDS, classifyFailure, failureMessage, loadInfoArgs, parseResolved, resolveArgs, streamArgs } from '../src/lib/music/ytdlp.js';
import { hasAnyRole } from '../src/lib/permissions.js';

const ID = 'dQw4w9WgXcQ';
const URL_DO_ID = `https://www.youtube.com/watch?v=${ID}`;

describe('pedido de música', () => {
	it.each([
		`https://www.youtube.com/watch?v=${ID}`,
		`https://youtu.be/${ID}?si=abc`,
		`youtube.com/watch?v=${ID}`,
		`https://music.youtube.com/watch?v=${ID}&list=RDxyz`,
		`https://m.youtube.com/watch?v=${ID}`,
		`https://www.youtube.com/shorts/${ID}`,
		`https://www.youtube.com/live/${ID}`,
		`https://www.youtube.com/embed/${ID}`,
		`  HTTPS://WWW.YOUTUBE.COM/watch?v=${ID}&t=42s  `
	])('reconhece o vídeo em %s e remonta o link', (input) => {
		expect(parseQuery(input)).toEqual({ kind: 'video', id: ID, url: URL_DO_ID });
	});

	it('reconhece playlist sem vídeo', () => {
		expect(parseQuery('https://www.youtube.com/playlist?list=PLxyz')).toEqual({ kind: 'playlist' });
		expect(parseQuery('https://www.youtube.com/watch?list=PLxyz')).toEqual({ kind: 'playlist' });
	});

	it.each([
		'https://www.youtube.com/watch?v=curto',
		`https://youtube.com.evil.com/watch?v=${ID}`,
		`https://youtube.com@evil.com/watch?v=${ID}`,
		'http://prometheus:9090/',
		'http://127.0.0.1:8080/metrics',
		'https://vimeo.com/1',
		'https://www.youtube.com/',
		'youtu.be/',
		'   '
	])('recusa %j', (input) => {
		expect(parseQuery(input)).toEqual({ kind: 'invalid' });
	});

	it('trata o resto como busca, com o texto intacto', () => {
		expect(parseQuery('pink floyd time')).toEqual({ kind: 'search', text: 'pink floyd time' });
		expect(parseQuery('--exec rm -rf')).toEqual({ kind: 'search', text: '--exec rm -rf' });
		expect(parseQuery('despacito')).toEqual({ kind: 'search', text: 'despacito' });
		expect(parseQuery(`youtube.com.evil.com/watch?v=${ID}`)).toEqual({ kind: 'search', text: `youtube.com.evil.com/watch?v=${ID}` });
	});
});

describe('fila', () => {
	const track = (id: string, durationSeconds: number | null = 60): Track => ({
		id,
		title: id,
		url: `https://www.youtube.com/watch?v=${id}`,
		durationSeconds,
		channel: null,
		requestedBy: 'ana'
	});

	it('mantém a ordem de chegada e devolve a posição', () => {
		const queue = new TrackQueue();
		expect(queue.push(track('a'))).toBe(1);
		expect(queue.push(track('b'))).toBe(2);
		expect(queue.list().map((item) => item.id)).toEqual(['a', 'b']);
		expect(queue.shift()?.id).toBe('a');
		expect(queue.size).toBe(1);
	});

	it(`para em ${MAX_QUEUE} músicas`, () => {
		const queue = new TrackQueue();
		for (let index = 1; index <= MAX_QUEUE; index++) expect(queue.push(track(`t${index}`))).toBe(index);
		expect(queue.push(track('extra'))).toBeNull();
		expect(queue.size).toBe(MAX_QUEUE);
		expect(queue.list(10)).toHaveLength(10);
	});

	it('esvazia e soma só as durações conhecidas', () => {
		const queue = new TrackQueue();
		queue.push(track('a', 100));
		queue.push(track('b', null));
		queue.push(track('c', 25));
		expect(queue.totalSeconds()).toBe(125);
		queue.clear();
		expect(queue.size).toBe(0);
		expect(queue.totalSeconds()).toBe(0);
	});
});

describe('limite de resoluções', () => {
	const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

	it('roda uma tarefa por vez, na ordem de chegada', async () => {
		const limiter = new Limiter(1, 5);
		const events: string[] = [];
		const task = (name: string) => async () => {
			events.push(`começa ${name}`);
			await tick();
			events.push(`termina ${name}`);
			return name;
		};

		expect(await Promise.all(['a', 'b', 'c'].map((name) => limiter.run(task(name))))).toEqual(['a', 'b', 'c']);
		expect(events).toEqual(['começa a', 'termina a', 'começa b', 'termina b', 'começa c', 'termina c']);
	});

	it('recusa a sétima simultânea sem rodá-la', async () => {
		const limiter = new Limiter(1, 5);
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		let started = 0;
		const runs = Array.from({ length: 7 }, () =>
			limiter.run(async () => {
				started++;
				await gate;
				return 'ok';
			})
		);

		expect(await runs[6]).toBeNull();
		release();
		expect(await Promise.all(runs.slice(0, 6))).toEqual(Array(6).fill('ok'));
		expect(started).toBe(6);
	});

	it('libera a vaga quando a tarefa lança', async () => {
		const limiter = new Limiter(1, 5);
		const failing = limiter.run(async () => {
			await tick();
			throw new Error('falhou');
		});
		const next = limiter.run(async () => 'depois');

		await expect(failing).rejects.toThrow('falhou');
		expect(await next).toBe('depois');
		expect(await limiter.run(async () => 'livre')).toBe('livre');
	});
});

describe('resposta do yt-dlp', () => {
	const video = { id: ID, title: 'Rick Astley - Never Gonna Give You Up', duration: 213, uploader: 'Rick Astley', live_status: 'not_live' };

	it('lê o primeiro resultado da busca', () => {
		const search = {
			_type: 'playlist',
			id: 'pink floyd time',
			entries: [{ id: 'Qr0-7Ds79zo', title: 'Pink Floyd – Time (Official Audio)', duration: 413, channel: 'Pink Floyd', uploader: 'Pink Floyd - Topic' }]
		};
		expect(parseResolved(search)).toEqual({
			ok: true,
			track: {
				id: 'Qr0-7Ds79zo',
				title: 'Pink Floyd – Time (Official Audio)',
				url: 'https://www.youtube.com/watch?v=Qr0-7Ds79zo',
				durationSeconds: 413,
				channel: 'Pink Floyd'
			}
		});
	});

	it('lê um vídeo, com o uploader quando falta o canal', () => {
		expect(parseResolved(video)).toEqual({
			ok: true,
			track: { id: ID, title: video.title, url: URL_DO_ID, durationSeconds: 213, channel: 'Rick Astley' }
		});
	});

	it('não acha nada numa busca vazia', () => {
		expect(parseResolved({ _type: 'playlist', id: 'xyz', entries: [] })).toEqual({ ok: false, reason: 'no-results' });
		expect(parseResolved(null)).toEqual({ ok: false, reason: 'no-results' });
	});

	it('recusa transmissões ao vivo e agendadas', () => {
		expect(parseResolved({ ...video, duration: null, live_status: 'is_live' })).toEqual({ ok: false, reason: 'live' });
		expect(parseResolved({ ...video, live_status: 'is_upcoming' })).toEqual({ ok: false, reason: 'live' });
		expect(parseResolved({ ...video, live_status: undefined, is_live: true })).toEqual({ ok: false, reason: 'live' });
	});

	it(`recusa faixas acima de ${MAX_TRACK_SECONDS / 60} minutos`, () => {
		expect(parseResolved({ ...video, duration: MAX_TRACK_SECONDS + 1 })).toEqual({ ok: false, reason: 'too-long' });
		expect(parseResolved({ ...video, duration: MAX_TRACK_SECONDS }).ok).toBe(true);
	});

	it('recusa ID inválido e aceita duração desconhecida', () => {
		expect(parseResolved({ ...video, id: 'curto' })).toEqual({ ok: false, reason: 'no-results' });
		expect(parseResolved({ ...video, id: `${ID}&list=x` })).toEqual({ ok: false, reason: 'no-results' });
		expect(parseResolved({ ...video, duration: null })).toMatchObject({ ok: true, track: { durationSeconds: null } });
	});

	it.each([
		['ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication.', 'bot-check'],
		["ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you're not a bot. This helps protect our community.", 'bot-check'],
		['ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm your age. This video may be inappropriate for some users.', 'age'],
		['ERROR: [youtube] dQw4w9WgXcQ: This video is age-restricted', 'age'],
		["ERROR: [youtube] dQw4w9WgXcQ: Private video. Sign in if you've been granted access to this video", 'unavailable'],
		['ERROR: [youtube] dQw4w9WgXcQ: Video unavailable. This video has been removed by the uploader', 'unavailable'],
		['ERROR: [youtube] dQw4w9WgXcQ: The uploader has not made this video available in your country', 'unavailable'],
		['ERROR: [youtube] dQw4w9WgXcQ: This video is not available from your location due to geo restriction', 'unavailable'],
		['ERROR: [youtube] dQw4w9WgXcQ: This video is not available in your country', 'unavailable'],
		['ERROR: [youtube] dQw4w9WgXcQ: Join this channel to get access to members-only content like this video', 'unavailable'],
		['ERROR: [youtube] dQw4w9WgXcQ: Requested format is not available. Use --list-formats for a list of available formats', 'failure'],
		['ERROR: unable to download video data: HTTP Error 403: Forbidden', 'bot-check'],
		['ERROR: [youtube] dQw4w9WgXcQ: Unable to download API page: HTTP Error 429: Too Many Requests', 'bot-check'],
		['ERROR: unable to download video data: HTTP Error 4030: Forbidden', 'failure'],
		['', 'failure']
	])('classifica %j como %s', (stderr, expected) => {
		expect(classifyFailure(stderr)).toBe(expected);
	});

	it('só força o IPv6 quando pedido', () => {
		expect(resolveArgs(URL_DO_ID)).not.toContain('--force-ipv6');
		expect(resolveArgs(URL_DO_ID, { forceIpv6: true })).toContain('--force-ipv6');
		expect(streamArgs(URL_DO_ID, { forceIpv6: true })).toContain('--force-ipv6');
		expect(loadInfoArgs('/cache/info/x.json', { forceIpv6: true })).toContain('--force-ipv6');
		// O alvo fica sempre depois do --, onde nenhuma opção entra
		expect(resolveArgs(URL_DO_ID, { forceIpv6: true }).slice(-2)).toEqual(['--', URL_DO_ID]);
		expect(resolveArgs(URL_DO_ID, { cacheDir: '/cache/yt-dlp' })).toContain('/cache/yt-dlp');
	});

	it('explica cada falha em português', () => {
		expect(failureMessage('unavailable')).toBe('Esse vídeo está indisponível (privado, removido ou bloqueado no Brasil).');
		expect(failureMessage('bot-check')).toBe('O YouTube bloqueou o bot por enquanto. Tente mais tarde.');
	});
});

describe('duração da faixa', () => {
	it('escreve no formato do relógio', () => {
		expect(formatTrackTime(225)).toBe('3:45');
		expect(formatTrackTime(3723)).toBe('1:02:03');
		expect(formatTrackTime(59.9)).toBe('0:59');
		expect(formatTrackTime(null)).toBe('?');
	});
});

describe('acesso à música', () => {
	const GUILD = '111111111111111111';

	it('exige um cargo além do @everyone', () => {
		expect(hasAnyRole([GUILD], GUILD)).toBe(false);
		expect(hasAnyRole([GUILD, '222222222222222222'], GUILD)).toBe(true);
		expect(hasAnyRole([], GUILD)).toBe(false);
	});
});
