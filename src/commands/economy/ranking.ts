import { Command } from '@sapphire/framework';
import { buildRankingEmbed } from '../../lib/ranking.js';

export class RankingCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, {
			...options,
			name: 'ranking',
			description: 'Exibe o Ranking Global de usuários do servidor'
		});
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const { guild } = interaction;
		if (!guild) {
			return interaction.reply({ content: 'Este comando só pode ser usado em um servidor.', flags: ['Ephemeral'] });
		}

		await interaction.deferReply();

		try {
			const embed = await buildRankingEmbed(guild);
			return interaction.editReply({ embeds: [embed] });
		} catch (error) {
			this.container.logger.error('Erro ao buscar ranking:', error);
			return interaction.editReply({ content: '❌ Ocorreu um erro ao carregar o ranking.' });
		}
	}
}
