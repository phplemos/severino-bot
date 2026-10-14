import { setTimeout as sleep } from 'node:timers/promises';
import {
	NetworkingStatusCode,
	VoiceConnectionDisconnectReason,
	VoiceConnectionStatus,
	type VoiceConnectionState
} from '@discordjs/voice';

/**
 * O estado em uma etapa: `signalling` = esperando os dados do servidor de voz pelo gateway;
 * `connecting/<etapa>` = falando com o servidor de voz (WebSocket, UDP, protocolo); `disconnected/<motivo>`.
 */
export function describeVoiceState(state: VoiceConnectionState): string {
	switch (state.status) {
		case VoiceConnectionStatus.Connecting:
			return `connecting/${NetworkingStatusCode[state.networking.state.code]}`;
		case VoiceConnectionStatus.Disconnected:
			return state.reason === VoiceConnectionDisconnectReason.WebSocketClose
				? `disconnected/close ${state.closeCode}`
				: `disconnected/${VoiceConnectionDisconnectReason[state.reason]}`;
		default:
			return state.status;
	}
}

/** Os estados por que a conexão passou ao entrar, com o tempo desde o início, para o log dizer onde ela parou. */
export class JoinTrace {
	private readonly steps: string[] = [];
	private last = '';

	public constructor(private readonly started = Date.now()) {}

	public record(state: VoiceConnectionState, now = Date.now()): void {
		const step = describeVoiceState(state);
		// A conexão repete o estado a cada mudança interna da rede; só as diferentes interessam
		if (step === this.last) return;
		this.last = step;
		this.steps.push(`${step} (${now - this.started} ms)`);
	}

	public toString(): string {
		return this.steps.join(' → ');
	}
}

/** Roda a tarefa até `attempts` vezes, com `delayMs` entre elas; se todas falharem, lança o erro da última. */
export async function withRetry<T>(attempts: number, delayMs: number, task: (attempt: number) => Promise<T>): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await task(attempt);
		} catch (error) {
			if (attempt >= attempts) throw error;
			await sleep(delayMs);
		}
	}
}
