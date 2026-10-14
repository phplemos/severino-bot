import { Events, Listener } from '@sapphire/framework';
import type { VoiceState } from 'discord.js';
import { config } from '../config.js';
import { registerActivity } from '../lib/activity.js';
import { metrics } from '../lib/metrics.js';
import { onVoiceStateUpdate } from '../lib/music/session.js';
import { prisma } from '../lib/prisma.js';
import { deleteRoomIfEmpty, handleHubJoin } from '../lib/tempRooms.js';

export class VoiceStateUpdateListener extends Listener<typeof Events.VoiceStateUpdate> {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, { ...options, event: Events.VoiceStateUpdate });
	}

	// Mudanças de mudo/ensurdecido não importam aqui: o tempo de voz é contado minuto a minuto
	public async run(oldState: VoiceState, newState: VoiceState) {
		if (newState.guild.id !== config.GUILD_ID || oldState.channelId === newState.channelId) return;
		// Antes da guarda de bots, para a música enxergar o próprio bot movido ou expulso, e antes do banco,
		// para que uma falha dele não deixe o bot preso no canal
		onVoiceStateUpdate(oldState, newState);
		const member = newState.member ?? oldState.member;
		if (!member || member.user.bot) return;

		if (newState.channelId) {
			if ((await registerActivity(member.id)) > 0) metrics.dailyClaims++;

			const hub = await prisma.hubChannel.findUnique({ where: { id: newState.channelId } });
			if (hub && newState.channel) await handleHubJoin(member, newState.channel, hub);
		}

		if (oldState.channelId) await deleteRoomIfEmpty(oldState.guild, oldState.channelId);
	}
}
