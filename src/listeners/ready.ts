import { Listener } from '@sapphire/framework';
import { Client } from 'discord.js';
import { syncGuildMembers, recordVoiceJoin } from '../lib/user.js';

export class ReadyListener extends Listener {
	public constructor(context: Listener.Context, options: Listener.Options) {
		super(context, {
			...options,
			once: true,
			event: 'ready'
		});
	}

	public async run(client: Client) {
		this.container.logger.info(`Bot logged in as ${client.user?.tag}`);

		const autoSync = process.env.AUTO_SYNC_MEMBERS !== 'false';

		for (const guild of client.guilds.cache.values()) {
			try {
				if (autoSync) {
					this.container.logger.info(`Starting retroactive sync for guild: ${guild.name} (${guild.id})`);
					const syncedCount = await syncGuildMembers(guild);
					this.container.logger.info(`Successfully synced ${syncedCount} members in ${guild.name}`);
				}

				// Track users currently active in voice channels
				for (const voiceState of guild.voiceStates.cache.values()) {
					if (voiceState.channelId && voiceState.member && !voiceState.member.user.bot) {
						await recordVoiceJoin(voiceState.member.id);
					}
				}
			} catch (error) {
				this.container.logger.error(`Error performing startup sync for guild ${guild.name}:`, error);
			}
		}
	}
}
