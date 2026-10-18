import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { metrics } from '../metrics.js';
import { formatTime } from '../time.js';

/**
 * Depois de um "confirme que não é robô", o bot deixa o YouTube em paz por 1 hora: insistir piora a
 * marcação do IP. Durante a pausa, só toca o que já está no cache.
 */
export const BLOCK_MS = 60 * 60_000;

let blockedUntil = 0;
let gaugeReset: NodeJS.Timeout | null = null;
// Onde a pausa fica gravada para sobreviver a reinícios; sem arquivo, ela vale só em memória
let storePath: string | null = null;

function apply(until: number, now: number): void {
	blockedUntil = until;
	metrics.musicYoutubeBlocked = 1;
	if (gaugeReset) clearTimeout(gaugeReset);
	gaugeReset = setTimeout(() => {
		metrics.musicYoutubeBlocked = 0;
		gaugeReset = null;
	}, until - now);
	gaugeReset.unref();
}

/** Começa (ou estica) a pausa e devolve até quando ela vai. */
export function blockYoutube(now = Date.now()): Date {
	apply(Math.max(blockedUntil, now + BLOCK_MS), now);
	if (storePath) {
		try {
			mkdirSync(dirname(storePath), { recursive: true });
			writeFileSync(storePath, JSON.stringify({ until: blockedUntil }));
		} catch {
			// Sem disco, a pausa vale até o próximo reinício
		}
	}
	return new Date(blockedUntil);
}

/**
 * Passa a gravar a pausa em `path` e retoma a que valia antes do reinício. Um prazo além de 1 hora
 * (arquivo editado ou relógio que voltou) vira 1 hora a partir de agora.
 */
export function restoreYoutubeBlock(path: string, now = Date.now()): Date | null {
	storePath = path;
	let saved: unknown;
	try {
		saved = JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		return null;
	}
	const until = typeof saved === 'object' && saved !== null && 'until' in saved ? saved.until : null;
	if (typeof until !== 'number' || !(until > now)) return null;
	apply(Math.max(blockedUntil, Math.min(until, now + BLOCK_MS)), now);
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
	storePath = null;
	if (gaugeReset) clearTimeout(gaugeReset);
	gaugeReset = null;
	metrics.musicYoutubeBlocked = 0;
}
