import { Listener } from '@sapphire/framework';
import { GuildMember } from 'discord.js';
import { upsertUserFromMember } from '../lib/user.js';

export class GuildMemberUpdateListener extends Listener {
	public constructor(context: Listener.Context, options: Listener.Options) {
		super(context, {
			...options,
			event: 'guildMemberUpdate'
		});
	}

	public async run(_oldMember: GuildMember, newMember: GuildMember) {
		try {
			await upsertUserFromMember(newMember);
			this.container.logger.debug(`Updated member details for: ${newMember.user.tag}`);
		} catch (error) {
			this.container.logger.error(`Failed to update member ${newMember.user.tag}:`, error);
		}
	}
}
