/** Raiz quadrada inteira exata, sem erro de ponto flutuante nas fronteiras de nível. */
function isqrt(value: number): number {
	let root = Math.floor(Math.sqrt(value));
	while (root * root > value) root--;
	while ((root + 1) * (root + 1) <= value) root++;
	return root;
}

/** Nível a partir do XP: nível 2 aos 100 XP, 3 aos 400, 4 aos 900 (a mesma curva de antes). */
export function levelFromXp(xp: number): number {
	return Math.floor(isqrt(Math.max(0, Math.floor(xp))) / 10) + 1;
}

/** XP mínimo para alcançar o nível. */
export function xpForLevel(level: number): number {
	return 100 * (level - 1) ** 2;
}

/** Nível atual e quanto falta para o próximo. */
export function levelProgress(xp: number): { level: number; current: number; needed: number } {
	const level = levelFromXp(xp);
	const floor = xpForLevel(level);
	return { level, current: xp - floor, needed: xpForLevel(level + 1) - floor };
}
