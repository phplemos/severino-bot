import { Command } from '@sapphire/framework';
import { buildRankingEmbeds, type RankingPeriod } from '../lib/ranking.js';

export class RankingCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, { ...options, name: 'ranking', description: 'Mostra o ranking geral e o da semana', preconditions: ['GuildOnly'] });
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addStringOption((option) =>
					option
						.setName('periodo')
						.setDescription('Qual ranking mostrar (padrão: os dois)')
						.addChoices({ name: 'Geral', value: 'geral' }, { name: 'Semanal', value: 'semanal' })
				)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const period = interaction.options.getString('periodo') as RankingPeriod | null;
		await interaction.deferReply();
		const embeds = await buildRankingEmbeds(interaction.guild!, period ? [period] : ['geral', 'semanal']);
		return interaction.editReply({ embeds });
	}
}
