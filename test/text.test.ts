import { describe, expect, it } from 'vitest';
import { formatDuration, formatNumber } from '../src/lib/format.js';
import { rankingLines } from '../src/lib/ranking.js';
import { renderRoomName } from '../src/lib/tempRooms.js';

describe('formatação', () => {
	it('escreve durações em português', () => {
		expect(formatDuration(0)).toBe('0min');
		expect(formatDuration(59)).toBe('0min');
		expect(formatDuration(45 * 60)).toBe('45min');
		expect(formatDuration(2 * 3600 + 5 * 60)).toBe('2h 5min');
		expect(formatDuration(54.9 * 3600)).toBe('2d 6h 54min');
	});

	it('separa milhar com ponto', () => {
		expect(formatNumber(11073)).toBe('11.073');
	});
});

describe('nome das salas', () => {
	it('troca todas as ocorrências de {user}', () => {
		expect(renderRoomName('Quarto de {user}', 'Vitin')).toBe('Quarto de Vitin');
		expect(renderRoomName('{user} & {user}', 'A')).toBe('A & A');
	});

	it('não interpreta padrões especiais do apelido', () => {
		expect(renderRoomName('Quarto de {user}', '$& $1')).toBe('Quarto de $& $1');
	});

	it('respeita o limite de 100 caracteres do Discord', () => {
		expect(renderRoomName('Quarto de {user}', 'x'.repeat(200))).toHaveLength(100);
	});
});

describe('linhas do ranking', () => {
	const entries = [
		{ id: '1', name: 'Ana', xp: 3314, voiceSeconds: 54 * 3600 },
		{ id: '2', name: 'b_o*b', xp: 400, voiceSeconds: 600 },
		{ id: '3', name: 'Caio', xp: 120, voiceSeconds: 0 },
		{ id: '4', name: 'Duda', xp: 10, voiceSeconds: 0 }
	];

	it('mostra medalhas, nível e voz no ranking geral', () => {
		const lines = rankingLines(entries, 'geral').split('\n');
		expect(lines[0]).toBe('🥇 **Ana** · nível 6 · 3.314 XP · 2d 6h de voz');
		expect(lines[3]).toBe('**4.** **Duda** · nível 1 · 10 XP · 0min de voz');
	});

	it('escapa a formatação do Discord nos nomes', () => {
		expect(rankingLines(entries, 'geral').split('\n')[1]).toContain('b\\_o\\*b');
	});

	it('não mostra nível no ranking da semana', () => {
		expect(rankingLines(entries.slice(0, 1), 'semanal')).toBe('🥇 **Ana** · 3.314 XP · 2d 6h de voz');
	});
});
