import { NetworkingStatusCode, VoiceConnectionDisconnectReason, VoiceConnectionStatus, type VoiceConnectionState } from '@discordjs/voice';
import { describe, expect, it } from 'vitest';
import { JoinTrace, describeVoiceState, withRetry } from '../src/lib/music/join.js';

// Só os campos que describeVoiceState lê
const signalling = { status: VoiceConnectionStatus.Signalling } as VoiceConnectionState;
const connecting = (code: NetworkingStatusCode) =>
	({ status: VoiceConnectionStatus.Connecting, networking: { state: { code } } }) as unknown as VoiceConnectionState;
const ready = { status: VoiceConnectionStatus.Ready } as VoiceConnectionState;

describe('entrada no canal de voz', () => {
	it('descreve cada estado', () => {
		expect(describeVoiceState(signalling)).toBe('signalling');
		expect(describeVoiceState(connecting(NetworkingStatusCode.UdpHandshaking))).toBe('connecting/UdpHandshaking');
		expect(describeVoiceState(ready)).toBe('ready');
		expect(
			describeVoiceState({
				status: VoiceConnectionStatus.Disconnected,
				reason: VoiceConnectionDisconnectReason.WebSocketClose,
				closeCode: 4014
			} as VoiceConnectionState)
		).toBe('disconnected/close 4014');
		expect(
			describeVoiceState({
				status: VoiceConnectionStatus.Disconnected,
				reason: VoiceConnectionDisconnectReason.AdapterUnavailable
			} as VoiceConnectionState)
		).toBe('disconnected/AdapterUnavailable');
	});

	it('registra as etapas com o tempo e ignora repetições', () => {
		const trace = new JoinTrace(1000);
		trace.record(signalling, 1000);
		trace.record(connecting(NetworkingStatusCode.OpeningWs), 1180);
		trace.record(connecting(NetworkingStatusCode.OpeningWs), 1200);
		trace.record(connecting(NetworkingStatusCode.Identifying), 1350);
		expect(String(trace)).toBe('signalling (0 ms) → connecting/OpeningWs (180 ms) → connecting/Identifying (350 ms)');
	});

	it('tenta de novo e devolve o resultado da tentativa que deu certo', async () => {
		const attempts: number[] = [];
		const result = await withRetry(2, 1, async (attempt) => {
			attempts.push(attempt);
			if (attempt === 1) throw new Error('travou');
			return 'entrou';
		});
		expect(result).toBe('entrou');
		expect(attempts).toEqual([1, 2]);
	});

	it('lança o erro da última tentativa e não passa do limite', async () => {
		let calls = 0;
		await expect(
			withRetry(2, 1, async (attempt) => {
				calls++;
				throw new Error(`falha ${attempt}`);
			})
		).rejects.toThrow('falha 2');
		expect(calls).toBe(2);
	});

	it('não espera quando a primeira tentativa dá certo', async () => {
		const started = Date.now();
		await expect(withRetry(2, 10_000, async () => 'entrou')).resolves.toBe('entrou');
		expect(Date.now() - started).toBeLessThan(1000);
	});
});
