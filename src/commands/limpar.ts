import { Command } from '@sapphire/framework';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { audit } from '../lib/audit.js';

export class LimparCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, {
			...options,
			name: 'limpar',
			description: 'Apaga de 1 a 100 mensagens recentes deste canal',
			preconditions: ['GuildOnly'],
			requiredUserPermissions: [PermissionFlagsBits.ManageMessages],
			requiredClientPermissions: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory]
		});
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
				.addIntegerOption((option) =>
					option.setName('quantidade').setDescription('Quantas mensagens apagar (1 a 100)').setRequired(true).setMinValue(1).setMaxValue(100)
				)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const amount = interaction.options.getInteger('quantidade', true);
		const channel = interaction.channel;
		if (!channel || !channel.isTextBased() || channel.isDMBased()) {
			return interaction.reply({ content: 'Este comando só funciona em canais de texto do servidor.', flags: MessageFlags.Ephemeral });
		}

		// O Discord só apaga em massa mensagens com menos de 14 dias
		const deleted = await channel.bulkDelete(amount, true);
		await audit(interaction.user.id, 'limpar', channel.id, `${deleted.size} de ${amount} mensagens apagadas`);

		const skipped = amount - deleted.size;
		const note = skipped > 0 ? ` ${skipped} não puderam ser apagadas (o Discord não apaga em massa mensagens com mais de 14 dias).` : '';
		return interaction.reply({ content: `🧹 ${deleted.size} mensagens apagadas.${note}`, flags: MessageFlags.Ephemeral });
	}
}
