import { Events, Listener } from '@sapphire/framework';
import type { GuildMember } from 'discord.js';
import { config } from '../config.js';
import { upsertMember } from '../lib/members.js';

export class GuildMemberAddListener extends Listener<typeof Events.GuildMemberAdd> {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, { ...options, event: Events.GuildMemberAdd });
	}

	public async run(member: GuildMember) {
		if (member.guild.id !== config.GUILD_ID) return;
		await upsertMember(member);
	}
}
