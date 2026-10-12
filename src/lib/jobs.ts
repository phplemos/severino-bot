import { container } from '@sapphire/framework';
import { metrics } from './metrics.js';

const timers = new Set<NodeJS.Timeout>();

/**
 * Agenda uma rotina periódica. Erros são registrados sem derrubar o bot, e uma execução nunca
 * começa enquanto a anterior ainda está rodando.
 */
export function every(intervalMs: number, name: string, task: () => Promise<unknown>, { runNow = false } = {}): void {
	let running = false;
	const run = async () => {
		if (running) return;
		running = true;
		try {
			await task();
		} catch (error) {
			metrics.jobErrors++;
			container.logger.error(`[${name}] falhou:`, error);
		} finally {
			running = false;
		}
	};

	if (runNow) void run();
	timers.add(setInterval(() => void run(), intervalMs));
}

/** Para todas as rotinas (usado no desligamento). */
export function stopJobs(): void {
	for (const timer of timers) clearInterval(timer);
	timers.clear();
}
