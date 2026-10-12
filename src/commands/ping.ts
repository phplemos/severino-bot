import { Command } from '@sapphire/framework';

export class PingCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, { ...options, name: 'ping', description: 'Mostra a latência do bot' });
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) => builder.setName(this.name).setDescription(this.description));
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.reply('Medindo...');
		const reply = await interaction.fetchReply();
		const roundTrip = reply.createdTimestamp - interaction.createdTimestamp;
		return interaction.editReply(`🏓 Pong! Gateway: ${Math.round(this.container.client.ws.ping)} ms · ida e volta: ${roundTrip} ms.`);
	}
}
