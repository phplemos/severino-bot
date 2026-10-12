import { Events, Listener } from '@sapphire/framework';
import type { Guild } from 'discord.js';
import { config } from '../config.js';
import { leaveIfNotAllowed } from '../lib/guilds.js';

export class GuildCreateListener extends Listener<typeof Events.GuildCreate> {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, { ...options, event: Events.GuildCreate });
	}

	public async run(guild: Guild) {
		await leaveIfNotAllowed(guild, config.GUILD_ID);
	}
}
