import { Events, Listener } from '@sapphire/framework';
import type { GuildMember, PartialGuildMember } from 'discord.js';
import { config } from '../config.js';
import { markMemberLeft } from '../lib/members.js';

export class GuildMemberRemoveListener extends Listener<typeof Events.GuildMemberRemove> {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, { ...options, event: Events.GuildMemberRemove });
	}

	public async run(member: GuildMember | PartialGuildMember) {
		if (member.guild.id !== config.GUILD_ID) return;
		await markMemberLeft(member);
	}
}
