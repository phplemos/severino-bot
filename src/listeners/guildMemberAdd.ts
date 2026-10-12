import { Listener } from '@sapphire/framework';
import { GuildMember } from 'discord.js';
import { upsertUserFromMember } from '../lib/user.js';

export class GuildMemberAddListener extends Listener {
	public constructor(context: Listener.Context, options: Listener.Options) {
		super(context, {
			...options,
			event: 'guildMemberAdd'
		});
	}

	public async run(member: GuildMember) {
		try {
			await upsertUserFromMember(member);
			this.container.logger.info(`Synced new member: ${member.user.tag}`);
		} catch (error) {
			this.container.logger.error(`Failed to sync joining member ${member.user.tag}:`, error);
		}
	}
}
