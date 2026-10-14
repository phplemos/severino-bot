import { VIDEO_ID, videoUrl } from './query.js';
import type { Track } from './queue.js';

export const RESOLVE_TIMEOUT_MS = 30_000;
// O buffer do openAudio guarda uns 35 minutos; a faixa inteira precisa caber nele
export const MAX_TRACK_SECONDS = 30 * 60;

const AUDIO_FORMAT = 'bestaudio[acodec=opus]/bestaudio/best';
// Sem cache em disco, o cache do yt-dlp (scripts do player do YouTube) fica no /tmp e some a cada reinício
export const DEFAULT_YTDLP_CACHE = '/tmp/yt-dlp';
const common = (cacheDir: string) => [
	'--ignore-config', '--quiet', '--no-warnings', '--no-progress', '--no-playlist',
	'--js-runtimes', 'node', '--cache-dir', cacheDir, '--socket-timeout', '15'
];

/** target é a URL remontada pelo parseQuery ou `ytsearch1:<texto>`. Sem --flat-playlist: a busca também passa pela escolha de formato. */
export const resolveArgs = (target: string, cacheDir = DEFAULT_YTDLP_CACHE) => [...common(cacheDir), '-J', '-f', AUDIO_FORMAT, '--', target];
export const streamArgs = (url: string, cacheDir = DEFAULT_YTDLP_CACHE) => [...common(cacheDir), '-f', AUDIO_FORMAT, '-o', '-', '--', url];
/** Baixa a partir do JSON que o pedido já extraiu: nenhuma chamada nova à API do YouTube, só o download do áudio. */
export const loadInfoArgs = (infoPath: string, cacheDir = DEFAULT_YTDLP_CACHE) => [...common(cacheDir), '--load-info-json', infoPath, '-f', AUDIO_FORMAT, '-o', '-'];
export const FFMPEG_ARGS = [
	'-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn',
	'-ac', '2', '-ar', '48000', '-c:a', 'libopus', '-b:a', '128k', '-f', 'ogg', 'pipe:1'
];

export type ResolveResult =
	| { ok: true; track: Omit<Track, 'requestedBy'> }
	| { ok: false; reason: 'no-results' | 'live' | 'too-long' };

export type Info = Record<string, unknown>;
const isInfo = (value: unknown): value is Info => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

/** O dicionário do vídeo no JSON do `yt-dlp -J`: na busca, o primeiro resultado; no link, o próprio vídeo. */
export function resolvedEntry(json: unknown): Info | null {
	const info = isInfo(json) ? json : null;
	if (info?._type !== 'playlist') return info;
	return Array.isArray(info.entries) && isInfo(info.entries[0]) ? info.entries[0] : null;
}

/** Lê o JSON do `yt-dlp -J`: na busca, o primeiro resultado; no link, o próprio vídeo. */
export function parseResolved(json: unknown): ResolveResult {
	const info = resolvedEntry(json);
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
