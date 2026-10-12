import { Events, Listener } from '@sapphire/framework';
import type { GuildMember } from 'discord.js';
import { config } from '../config.js';
import { upsertMember } from '../lib/members.js';

export class GuildMemberUpdateListener extends Listener<typeof Events.GuildMemberUpdate> {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, { ...options, event: Events.GuildMemberUpdate });
	}

	public async run(_oldMember: GuildMember, newMember: GuildMember) {
		if (newMember.guild.id !== config.GUILD_ID) return;
		await upsertMember(newMember);
	}
}
