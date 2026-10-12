import { describe, expect, it } from 'vitest';
import { eligibleVoiceUsers, type VoiceSnapshot } from '../src/lib/voice.js';

const AFK = 'afk';
const state = (userId: string, channelId: string, extra: Partial<VoiceSnapshot> = {}): VoiceSnapshot => ({
	userId,
	channelId,
	isBot: false,
	deafened: false,
	...extra
});

describe('quem ganha tempo de voz', () => {
	it('conta duas pessoas conversando, inclusive com microfone mudo', () => {
		expect(eligibleVoiceUsers([state('a', 'sala'), state('b', 'sala')], AFK)).toEqual(['a', 'b']);
	});

	it('não conta quem está sozinho', () => {
		expect(eligibleVoiceUsers([state('a', 'sala1'), state('b', 'sala2')], AFK)).toEqual([]);
	});

	it('não conta o canal AFK', () => {
		expect(eligibleVoiceUsers([state('a', AFK), state('b', AFK)], AFK)).toEqual([]);
	});

	it('não conta quem está ensurdecido, e ele também não faz companhia', () => {
		expect(eligibleVoiceUsers([state('a', 'sala'), state('b', 'sala', { deafened: true })], AFK)).toEqual([]);
		expect(eligibleVoiceUsers([state('a', 'sala'), state('b', 'sala'), state('c', 'sala', { deafened: true })], AFK)).toEqual(['a', 'b']);
	});

	it('ignora bots, que não contam nem fazem companhia', () => {
		expect(eligibleVoiceUsers([state('a', 'sala'), state('musica', 'sala', { isBot: true })], AFK)).toEqual([]);
	});

	it('funciona sem canal AFK configurado', () => {
		expect(eligibleVoiceUsers([state('a', 'sala'), state('b', 'sala')], null)).toEqual(['a', 'b']);
	});
});
