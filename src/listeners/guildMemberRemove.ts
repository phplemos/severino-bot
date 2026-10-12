import { Listener } from '@sapphire/framework';
import { GuildMember, PartialGuildMember } from 'discord.js';
import { prisma } from '../lib/prisma.js';

export class GuildMemberRemoveListener extends Listener {
	public constructor(context: Listener.Context, options: Listener.Options) {
		super(context, {
			...options,
			event: 'guildMemberRemove'
		});
	}

	public async run(member: GuildMember | PartialGuildMember) {
		try {
			await prisma.user.update({
				where: { id: member.id },
				data: { isInServer: false }
			});
			this.container.logger.info(`Marked member as left server: ${member.user.tag}`);
		} catch (error) {
			this.container.logger.error(`Failed to update leave status for member ${member.id}:`, error);
		}
	}
}
