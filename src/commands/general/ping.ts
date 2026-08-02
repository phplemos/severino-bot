import { Command } from '@sapphire/framework';
import { Message, ChatInputCommandInteraction } from 'discord.js';

export class PingCommand extends Command {
	public constructor(context: Command.Context, options: Command.Options) {
		super(context, {
			...options,
			description: 'Check bot latency'
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
		const msg = await message.reply('Ping?');
		const content = `Pong! Latency is ${Math.round(this.container.client.ws.ping)}ms. API Latency is ${
			msg.createdTimestamp - message.createdTimestamp
		}ms.`;

		return msg.edit(content);
	}

	public override async chatInputRun(interaction: ChatInputCommandInteraction) {
		const msg = await interaction.reply({ content: 'Ping?', fetchReply: true });
		const content = `Pong! Latency is ${Math.round(this.container.client.ws.ping)}ms. API Latency is ${
			msg.createdTimestamp - interaction.createdTimestamp
		}ms.`;

		return interaction.editReply(content);
	}
}
