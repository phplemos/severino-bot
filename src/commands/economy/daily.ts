import { Command } from '@sapphire/framework';
import { Message, ChatInputCommandInteraction } from 'discord.js';
import { checkAndClaimDaily, getOrCreateUser } from '../../lib/user.js';

export class DailyCommand extends Command {
	public constructor(context: Command.Context, options: Command.Options) {
		super(context, {
			...options,
			name: 'daily',
			description: 'Claim your daily reward'
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
		const response = await this.handleDaily(message.author.id);
		return message.reply(response);
	}

	public override async chatInputRun(interaction: ChatInputCommandInteraction) {
		const response = await this.handleDaily(interaction.user.id);
		return interaction.reply(response);
	}

	private async handleDaily(userId: string) {
		const reward = await checkAndClaimDaily(userId);

		if (!reward) {
			return 'You have already claimed your daily reward today! Come back tomorrow.';
		}

		return `💰 You claimed your daily reward of **${reward}** coins!`;
	}
}
