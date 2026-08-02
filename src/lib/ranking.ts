import { EmbedBuilder, Guild, TextChannel } from 'discord.js';
import { prisma } from './prisma.js';

export async function buildRankingEmbed(guild: Guild): Promise<EmbedBuilder> {
	const topUsers = await prisma.user.findMany({
		orderBy: [
			{ level: 'desc' },
			{ xp: 'desc' }
		],
		take: 10
	});

	const embed = new EmbedBuilder()
		.setTitle(`🏆 ${guild.name} — Ranking Global`)
		.setColor(0xffd700)
		.setTimestamp()
		.setFooter({ text: 'Atualizado em' });

	if (topUsers.length === 0) {
		embed.setDescription('Nenhum usuário registrado no ranking ainda.');
		return embed;
	}

	const medals = ['🥇', '🥈', '🥉'];
	const lines = await Promise.all(
		topUsers.map(async (u, index) => {
			const rankPrefix = medals[index] ?? `**#${index + 1}**`;
			let displayName = u.id;

			try {
				const member = await guild.members.fetch(u.id);
				if (member) displayName = member.displayName;
			} catch {
				// Member left or not cached, use ID
			}

			return `${rankPrefix} **${displayName}** — Nível ${u.level} | ${u.xp} XP | 💰 ${u.coins} moedas`;
		})
	);

	embed.setDescription(lines.join('\n'));
	return embed;
}

export async function updateGuildRanking(guild: Guild): Promise<void> {
	const config = await prisma.guildConfig.findUnique({
		where: { guildId: guild.id }
	});

	if (!config || !config.rankingChannelId || !config.rankingMessageId) return;

	try {
		const channel = await guild.channels.fetch(config.rankingChannelId);
		if (!channel || !channel.isTextBased()) return;

		const textChannel = channel as TextChannel;
		const message = await textChannel.messages.fetch(config.rankingMessageId);
		if (!message) return;

		const embed = await buildRankingEmbed(guild);
		await message.edit({ embeds: [embed] });
	} catch (error) {
		// Suppress error if channel or message is deleted/inaccessible
	}
}
