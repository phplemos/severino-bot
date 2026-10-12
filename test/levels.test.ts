import { describe, expect, it } from 'vitest';
import { levelFromXp, levelProgress, xpForLevel } from '../src/lib/levels.js';

describe('níveis', () => {
	it('mantém a curva antiga: nível 2 aos 100 XP, 3 aos 400, 4 aos 900', () => {
		expect(levelFromXp(0)).toBe(1);
		expect(levelFromXp(99)).toBe(1);
		expect(levelFromXp(100)).toBe(2);
		expect(levelFromXp(399)).toBe(2);
		expect(levelFromXp(400)).toBe(3);
		expect(levelFromXp(899)).toBe(3);
		expect(levelFromXp(900)).toBe(4);
		expect(levelFromXp(3314)).toBe(6);
	});

	it('é exato em todas as fronteiras até o nível 200', () => {
		for (let level = 1; level <= 200; level++) {
			expect(levelFromXp(xpForLevel(level))).toBe(level);
			if (level > 1) expect(levelFromXp(xpForLevel(level) - 1)).toBe(level - 1);
		}
	});

	it('trata XP negativo como zero', () => {
		expect(levelFromXp(-50)).toBe(1);
	});

	it('mostra o progresso até o próximo nível', () => {
		expect(levelProgress(450)).toEqual({ level: 3, current: 50, needed: 500 });
	});
});
