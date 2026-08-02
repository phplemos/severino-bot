import { Command, Args } from '@sapphire/framework';
import { PermissionFlagsBits, Message, TextChannel, ChatInputCommandInteraction } from 'discord.js';

export class ClearCommand extends Command {
	public constructor(context: Command.Context, options: Command.Options) {
		super(context, {
			...options,
			name: 'clear',
			aliases: ['purge'],
			description: 'Clears a specific amount of messages',
			preconditions: ['GuildOnly'],
			requiredUserPermissions: [PermissionFlagsBits.ManageMessages]
		});
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder //
				.setName(this.name)
				.setDescription(this.description)
				.addIntegerOption((option) =>
					option //
						.setName('amount')
						.setDescription('The amount of messages to clear (1-100)')
						.setRequired(true)
						.setMinValue(1)
						.setMaxValue(100)
				)
		);
	}

	public override async messageRun(message: Message, args: Args) {
		const amount = await args.pick('number').catch(() => 0);
		
		if (!message.channel.isTextBased() || message.channel.isDMBased()) {
			return message.reply('This command can only be used in a server text channel.');
		}

		const channel = message.channel as TextChannel;
		const response = await this.handleClear(channel, amount);
		
		if (typeof response === 'string') {
			return message.reply(response);
		}
		
		const reply = await channel.send(`🧹 Deleted **${response}** messages.`);
		setTimeout(() => reply.delete().catch(() => null), 5000);
		return;
	}

	public override async chatInputRun(interaction: ChatInputCommandInteraction) {
		const amount = interaction.options.getInteger('amount', true);
		
		if (!interaction.channel || !interaction.channel.isTextBased() || interaction.channel.isDMBased()) {
			return interaction.reply({ content: 'This command can only be used in a server text channel.', ephemeral: true });
		}

		const response = await this.handleClear(interaction.channel as TextChannel, amount);

		if (typeof response === 'string') {
			return interaction.reply({ content: response, ephemeral: true });
		}

		return interaction.reply({ content: `🧹 Deleted **${response}** messages.`, ephemeral: true });
	}

	private async handleClear(channel: TextChannel, amount: number) {
		if (amount <= 0 || amount > 100) {
			return 'Please provide a number between 1 and 100.';
		}

		try {
			const deleted = await channel.bulkDelete(amount, true);
			return deleted.size;
		} catch (error) {
			this.container.logger.error(error);
			return 'Failed to delete messages. They might be older than 14 days.';
		}
	}
}
