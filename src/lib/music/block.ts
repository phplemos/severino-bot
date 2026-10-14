import { metrics } from '../metrics.js';
import { formatTime } from '../time.js';

/**
 * Depois de um "confirme que não é robô", o bot deixa o YouTube em paz por 1 hora: insistir piora a
 * marcação do IP. Durante a pausa, só toca o que já está no cache.
 */
export const BLOCK_MS = 60 * 60_000;

let blockedUntil = 0;
let gaugeReset: NodeJS.Timeout | null = null;

/** Começa (ou estica) a pausa e devolve até quando ela vai. */
export function blockYoutube(now = Date.now()): Date {
	blockedUntil = Math.max(blockedUntil, now + BLOCK_MS);
	metrics.musicYoutubeBlocked = 1;
	if (gaugeReset) clearTimeout(gaugeReset);
	gaugeReset = setTimeout(() => {
		metrics.musicYoutubeBlocked = 0;
		gaugeReset = null;
	}, blockedUntil - now);
	gaugeReset.unref();
	return new Date(blockedUntil);
}

/** Até quando o bot evita o YouTube, ou null se está liberado. */
export function youtubeBlockedUntil(now = Date.now()): Date | null {
	return now < blockedUntil ? new Date(blockedUntil) : null;
}

/** "Até 11:52, só toco o que já está no cache.", para completar os avisos; vazio sem pausa. */
export function blockNotice(now = Date.now()): string {
	const until = youtubeBlockedUntil(now);
	return until ? `Até ${formatTime(until)}, só toco o que já está no cache.` : '';
}

/** Só para testes. */
export function resetYoutubeBlock(): void {
	blockedUntil = 0;
	if (gaugeReset) clearTimeout(gaugeReset);
	gaugeReset = null;
	metrics.musicYoutubeBlocked = 0;
}
