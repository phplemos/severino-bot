import type { Guild } from 'discord.js';

export interface VoiceSnapshot {
	userId: string;
	channelId: string;
	isBot: boolean;
	deafened: boolean;
}

/**
 * Quem ganha tempo de voz neste minuto: humanos fora do canal AFK, sem estar ensurdecidos e com
 * pelo menos mais uma pessoa ouvindo no mesmo canal. Microfone mudo conta.
 */
export function eligibleVoiceUsers(states: readonly VoiceSnapshot[], afkChannelId: string | null): string[] {
	const listeners = new Map<string, number>();
	for (const state of states) {
		if (state.isBot || state.deafened) continue;
		listeners.set(state.channelId, (listeners.get(state.channelId) ?? 0) + 1);
	}

	return states
		.filter((state) => !state.isBot && !state.deafened && state.channelId !== afkChannelId && (listeners.get(state.channelId) ?? 0) >= 2)
		.map((state) => state.userId);
}

/** Estado de voz atual do servidor, a partir do cache do Discord. */
export function snapshotGuildVoice(guild: Guild): VoiceSnapshot[] {
	const snapshots: VoiceSnapshot[] = [];
	for (const state of guild.voiceStates.cache.values()) {
		if (!state.channelId) continue;
		const user = state.member?.user ?? guild.client.users.cache.get(state.id);
		snapshots.push({
			userId: state.id,
			channelId: state.channelId,
			isBot: user?.bot ?? false,
			deafened: Boolean(state.selfDeaf || state.serverDeaf)
		});
	}
	return snapshots;
}
