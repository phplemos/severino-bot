import { VIDEO_ID, videoUrl } from './query.js';
import type { Track } from './queue.js';

export const RESOLVE_TIMEOUT_MS = 30_000;
// O buffer do openAudio guarda uns 35 minutos; a faixa inteira precisa caber nele
export const MAX_TRACK_SECONDS = 30 * 60;

const AUDIO_FORMAT = 'bestaudio[acodec=opus]/bestaudio/best';
const COMMON = [
	'--ignore-config', '--quiet', '--no-warnings', '--no-progress', '--no-playlist',
	'--js-runtimes', 'node', '--cache-dir', '/tmp/yt-dlp', '--socket-timeout', '15'
];

/** target é a URL remontada pelo parseQuery ou `ytsearch1:<texto>`. Sem --flat-playlist: a busca também passa pela escolha de formato. */
export const resolveArgs = (target: string) => [...COMMON, '-J', '-f', AUDIO_FORMAT, '--', target];
export const streamArgs = (url: string) => [...COMMON, '-f', AUDIO_FORMAT, '-o', '-', '--', url];
export const FFMPEG_ARGS = [
	'-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn',
	'-ac', '2', '-ar', '48000', '-c:a', 'libopus', '-b:a', '128k', '-f', 'ogg', 'pipe:1'
];

export type ResolveResult =
	| { ok: true; track: Omit<Track, 'requestedBy'> }
	| { ok: false; reason: 'no-results' | 'live' | 'too-long' };

type Info = Record<string, unknown>;
const isInfo = (value: unknown): value is Info => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

/** Lê o JSON do `yt-dlp -J`: na busca, o primeiro resultado; no link, o próprio vídeo. */
export function parseResolved(json: unknown): ResolveResult {
	let info = isInfo(json) ? json : null;
	if (info?._type === 'playlist') info = Array.isArray(info.entries) && isInfo(info.entries[0]) ? info.entries[0] : null;
	if (!info) return { ok: false, reason: 'no-results' };

	const id = info.id;
	if (typeof id !== 'string' || !VIDEO_ID.test(id)) return { ok: false, reason: 'no-results' };
	if (info.live_status === 'is_live' || info.live_status === 'is_upcoming' || info.is_live === true) return { ok: false, reason: 'live' };

	const duration = typeof info.duration === 'number' && Number.isFinite(info.duration) && info.duration >= 0 ? info.duration : null;
	if (duration !== null && duration > MAX_TRACK_SECONDS) return { ok: false, reason: 'too-long' };

	return {
		ok: true,
		track: { id, title: text(info.title) ?? id, url: videoUrl(id), durationSeconds: duration, channel: text(info.channel) ?? text(info.uploader) }
	};
}

export type YtDlpFailure = 'unavailable' | 'age' | 'bot-check' | 'failure';

const FAILURE_PATTERNS: [YtDlpFailure, RegExp][] = [
	['bot-check', /sign in to confirm you.re not a bot/i],
	['age', /confirm your age|age-restricted|inappropriate for some users/i],
	// Bloqueio regional: o YouTube diz "has not made this video available in your country", e o yt-dlp, "geo restriction"
	['unavailable', /private video|video unavailable|has been removed|not (?:made this video )?available in your country|geo restriction|members-only/i]
];

/** O tipo da falha a partir do stderr do yt-dlp. O que não for reconhecido é falha nossa ou do YouTube. */
export function classifyFailure(stderr: string): YtDlpFailure {
	return FAILURE_PATTERNS.find(([, pattern]) => pattern.test(stderr))?.[0] ?? 'failure';
}

const FAILURE_MESSAGES: Record<YtDlpFailure, string> = {
	unavailable: 'Esse vídeo está indisponível (privado, removido ou bloqueado no Brasil).',
	age: 'Esse vídeo tem restrição de idade e não consigo tocá-lo.',
	'bot-check': 'O YouTube bloqueou o bot por enquanto. Tente mais tarde.',
	failure: 'Não consegui buscar esse vídeo. O erro ficou registrado.'
};

/** Texto para a pessoa, o mesmo no pedido e na hora de tocar. */
export function failureMessage(reason: YtDlpFailure): string {
	return FAILURE_MESSAGES[reason];
}
