import { describe, expect, it } from 'vitest';
import { dayKey, daysSince, formatDate, formatDayKey, weekStartKey } from '../src/lib/time.js';

describe('dias no horário de Brasília', () => {
	it('vira o dia à meia-noite de Brasília, não às 21h (meia-noite UTC)', () => {
		expect(dayKey(new Date('2026-10-12T23:59:59Z'))).toBe('2026-10-12'); // 20:59 em Brasília
		expect(dayKey(new Date('2026-10-13T00:30:00Z'))).toBe('2026-10-12'); // 21:30 em Brasília
		expect(dayKey(new Date('2026-10-13T02:59:59Z'))).toBe('2026-10-12'); // 23:59 em Brasília
		expect(dayKey(new Date('2026-10-13T03:00:00Z'))).toBe('2026-10-13'); // 00:00 em Brasília
	});

	it('começa a semana na segunda-feira', () => {
		expect(weekStartKey(new Date('2026-10-12T15:00:00Z'))).toBe('2026-10-12'); // segunda
		expect(weekStartKey(new Date('2026-10-18T15:00:00Z'))).toBe('2026-10-12'); // domingo
		expect(weekStartKey(new Date('2026-10-19T02:59:00Z'))).toBe('2026-10-12'); // domingo 23:59 em Brasília
		expect(weekStartKey(new Date('2026-10-19T03:00:00Z'))).toBe('2026-10-19'); // segunda 00:00 em Brasília
		expect(weekStartKey(new Date('2027-01-01T12:00:00Z'))).toBe('2026-12-28'); // virada de ano
	});

	it('formata datas no padrão brasileiro', () => {
		expect(formatDate(new Date('2026-10-13T01:00:00Z'))).toBe('12/10/2026');
		expect(formatDayKey('2026-10-05')).toBe('05/10');
	});

	it('conta dias inteiros', () => {
		expect(daysSince(new Date('2026-10-10T12:00:00Z'), new Date('2026-10-12T11:59:59Z'))).toBe(1);
		expect(daysSince(new Date('2026-10-12T12:00:00Z'), new Date('2026-10-10T12:00:00Z'))).toBe(0);
	});
});
