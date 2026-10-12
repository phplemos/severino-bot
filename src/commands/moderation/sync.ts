import { Command } from '@sapphire/framework';
import { PermissionFlagsBits, Message, ChatInputCommandInteraction } from 'discord.js';
import { syncGuildMembers } from '../../lib/user.js';

export class SyncCommand extends Command {
	public constructor(context: Command.Context, options: Command.Options) {
		super(context, {
			...options,
			name: 'sync',
			description: 'Retroactively syncs all server member information into the database',
			preconditions: ['GuildOnly'],
			requiredUserPermissions: [PermissionFlagsBits.Administrator]
		});
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder //
				.setName(this.name)
				.setDescription(this.description)
		);
	}

	public override async messageRun(message: Message) {
		if (!message.guild) return;
		const reply = await message.reply('🔄 Syncing server members with database...');
		try {
			const count = await syncGuildMembers(message.guild);
			return reply.edit(`✅ Successfully synced **${count}** members in database.`);
		} catch (error) {
			this.container.logger.error('Sync failed:', error);
			return reply.edit('❌ Failed to sync server members.');
		}
	}

	public override async chatInputRun(interaction: ChatInputCommandInteraction) {
		if (!interaction.guild) return;
		await interaction.deferReply({ ephemeral: true });
		try {
			const count = await syncGuildMembers(interaction.guild);
			return interaction.editReply(`✅ Successfully synced **${count}** members in database.`);
		} catch (error) {
			this.container.logger.error('Sync failed:', error);
			return interaction.editReply('❌ Failed to sync server members.');
		}
	}
}
