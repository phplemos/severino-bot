const HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'];
const ID_IN_PATH = new Set(['shorts', 'live', 'embed']);

/** ID de vídeo do YouTube: 11 caracteres entre letras, números, `_` e `-`. */
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export type ParsedQuery =
	| { kind: 'video'; id: string; url: string } // url sempre https://www.youtube.com/watch?v=<id>
	| { kind: 'search'; text: string }
	| { kind: 'playlist' }
	| { kind: 'invalid' };

/** O link que chega ao yt-dlp é sempre remontado a partir do ID validado, nunca repassado como veio. */
export function videoUrl(id: string): string {
	return `https://www.youtube.com/watch?v=${id}`;
}

/** "youtube.com/watch?v=…" sem esquema: o texto começa por um host do YouTube seguido de caminho, porta ou nada. */
function startsWithHost(lower: string): boolean {
	return HOSTS.some((host) => lower.startsWith(host) && /^(?:[/?#:]|$)/.test(lower.slice(host.length)));
}

/**
 * O que a pessoa pediu: um vídeo do YouTube, uma playlist ou um texto de busca. Link de qualquer outro
 * host é recusado, porque o yt-dlp baixaria qualquer URL, inclusive dos serviços internos do homelab.
 */
export function parseQuery(input: string): ParsedQuery {
	const text = input.trim();
	if (!text) return { kind: 'invalid' };

	const lower = text.toLowerCase();
	const hasScheme = lower.startsWith('http://') || lower.startsWith('https://');
	if (/\s/.test(text) || !(hasScheme || startsWithHost(lower))) return { kind: 'search', text };

	let url: URL;
	try {
		url = new URL(hasScheme ? text : `https://${text}`);
	} catch {
		return { kind: 'invalid' };
	}
	const host = url.hostname.toLowerCase();
	if (!HOSTS.includes(host)) return { kind: 'invalid' };

	const segments = url.pathname.split('/').filter(Boolean);
	let id: string | null = null;
	if (host === 'youtu.be') {
		id = segments.length === 1 ? segments[0] : null;
	} else if (segments.length === 1 && segments[0] === 'watch') {
		// Um /watch com list= toca só o vídeo; sem v=, é a playlist
		id = url.searchParams.get('v');
		if (id === null && url.searchParams.has('list')) return { kind: 'playlist' };
	} else if (segments.length === 1 && segments[0] === 'playlist') {
		return url.searchParams.has('list') ? { kind: 'playlist' } : { kind: 'invalid' };
	} else if (segments.length === 2 && ID_IN_PATH.has(segments[0])) {
		id = segments[1];
	}

	return id !== null && VIDEO_ID.test(id) ? { kind: 'video', id, url: videoUrl(id) } : { kind: 'invalid' };
}
