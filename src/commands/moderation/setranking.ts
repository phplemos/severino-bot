import { Command } from '@sapphire/framework';
import { ChannelType, PermissionFlagsBits, TextChannel } from 'discord.js';
import { buildRankingEmbed } from '../../lib/ranking.js';
import { prisma } from '../../lib/prisma.js';

export class SetRankingCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, {
			...options,
			name: 'setranking',
			description: 'Define o canal para o Ranking Global auto-atualizável',
			requiredUserPermissions: [PermissionFlagsBits.ManageGuild]
		});
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addChannelOption((option) =>
					option
						.setName('channel')
						.setDescription('Canal de texto onde o ranking será publicado')
						.addChannelTypes(ChannelType.GuildText)
						.setRequired(true)
				)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const channel = interaction.options.getChannel('channel', true) as TextChannel;
		const { guild } = interaction;

		if (!guild) {
			return interaction.reply({ content: 'Este comando só pode ser usado em um servidor.', flags: ['Ephemeral'] });
		}

		await interaction.deferReply({ flags: ['Ephemeral'] });

		try {
			const embed = await buildRankingEmbed(guild);
			const rankingMsg = await channel.send({ embeds: [embed] });

			await prisma.guildConfig.upsert({
				where: { guildId: guild.id },
				update: {
					rankingChannelId: channel.id,
					rankingMessageId: rankingMsg.id
				},
				create: {
					guildId: guild.id,
					rankingChannelId: channel.id,
					rankingMessageId: rankingMsg.id
				}
			});

			return interaction.editReply({
				content: `✅ Canal de ranking configurado com sucesso em ${channel}!`
			});
		} catch (error) {
			this.container.logger.error('Erro ao configurar canal de ranking:', error);
			return interaction.editReply({
				content: '❌ Ocorreu um erro ao enviar a mensagem de ranking no canal especificado.'
			});
		}
	}
}
