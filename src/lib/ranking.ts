import { container } from '@sapphire/framework';
import { EmbedBuilder, RESTJSONErrorCodes, escapeMarkdown, type Guild } from 'discord.js';
import { isDiscordError } from './discord-errors.js';
import { formatDuration, formatNumber } from './format.js';
import { levelFromXp } from './levels.js';
import { prisma } from './prisma.js';
import { formatDayKey, weekStartKey } from './time.js';

export const RANKING_SIZE = 10;
const MEDALS = ['🥇', '🥈', '🥉'];

export interface RankingEntry {
	id: string;
	name: string;
	xp: number;
	voiceSeconds: number;
}

export type RankingPeriod = 'geral' | 'semanal';

/** Ranking geral: só membros atuais, sem bots e com pontuação. Empates resolvidos de forma estável. */
export async function topGeneral(limit = RANKING_SIZE): Promise<RankingEntry[]> {
	const users = await prisma.user.findMany({
		where: { isInServer: true, isBot: false, xp: { gt: 0 } },
		orderBy: [{ xp: 'desc' }, { totalVoiceSeconds: 'desc' }, { id: 'asc' }],
		take: limit,
		select: { id: true, displayName: true, username: true, xp: true, totalVoiceSeconds: true }
	});
	return users.map((user) => ({ id: user.id, name: user.displayName ?? user.username ?? user.id, xp: user.xp, voiceSeconds: user.totalVoiceSeconds }));
}

/** Ranking da semana: soma da atividade desde segunda-feira, 0h de Brasília. */
export async function topWeekly(weekStart: string = weekStartKey(), limit = RANKING_SIZE): Promise<RankingEntry[]> {
	const rows = await prisma.$queryRaw<{ id: string; displayName: string | null; username: string | null; xp: number; voiceSeconds: number }[]>`
		SELECT u."id", u."displayName", u."username", SUM(a."xp")::int AS "xp", SUM(a."voiceSeconds")::int AS "voiceSeconds"
		FROM "ActivityDay" a
		JOIN "User" u ON u."id" = a."userId"
		WHERE a."day" >= ${weekStart} AND u."isInServer" AND NOT u."isBot"
		GROUP BY u."id"
		HAVING SUM(a."xp") > 0
		ORDER BY "xp" DESC, "voiceSeconds" DESC, u."id" ASC
		LIMIT ${limit}`;
	return rows.map((row) => ({ id: row.id, name: row.displayName ?? row.username ?? row.id, xp: row.xp, voiceSeconds: row.voiceSeconds }));
}

/** Linhas do ranking. No geral mostra o nível; no semanal, só o que foi feito na semana. */
export function rankingLines(entries: readonly RankingEntry[], period: RankingPeriod): string {
	return entries
		.map((entry, index) => {
			const position = MEDALS[index] ?? `**${index + 1}.**`;
			const level = period === 'geral' ? `nível ${levelFromXp(entry.xp)} · ` : '';
			return `${position} **${escapeMarkdown(entry.name)}** · ${level}${formatNumber(entry.xp)} XP · ${formatDuration(entry.voiceSeconds)} de voz`;
		})
		.join('\n');
}

export async function buildRankingEmbeds(guild: Guild, periods: readonly RankingPeriod[] = ['geral', 'semanal']): Promise<EmbedBuilder[]> {
	const embeds: EmbedBuilder[] = [];

	if (periods.includes('geral')) {
		const entries = await topGeneral();
		embeds.push(
			new EmbedBuilder()
				.setTitle(`🏆 Ranking geral · ${guild.name}`)
				.setColor(0xffd700)
				.setDescription(entries.length > 0 ? rankingLines(entries, 'geral') : 'Ninguém pontuou ainda.')
				.setFooter({ text: 'XP: 5 a 15 por mensagem (uma vez por minuto) e 1 por minuto em call' })
		);
	}

	if (periods.includes('semanal')) {
		const weekStart = weekStartKey();
		const entries = await topWeekly(weekStart);
		embeds.push(
			new EmbedBuilder()
				.setTitle(`📅 Ranking da semana · desde ${formatDayKey(weekStart)}`)
				.setColor(0x5865f2)
				.setDescription(entries.length > 0 ? rankingLines(entries, 'semanal') : 'Ninguém pontuou nesta semana ainda.')
				.setFooter({ text: 'Zera toda segunda-feira à 0h (horário de Brasília) · última mudança' })
				.setTimestamp()
		);
	}

	return embeds;
}

export type RankingRefresh = 'sem-canal' | 'sem-mudanca' | 'editada' | 'recriada' | 'canal-removido';

let lastRendered = '';

/**
 * Mantém a mensagem fixa de ranking em dia. Se a mensagem sumiu, publica outra; se o canal foi
 * apagado, limpa a configuração. Só edita quando o conteúdo mudou.
 */
export async function refreshRankingMessage(guild: Guild, { force = false } = {}): Promise<RankingRefresh> {
	const config = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
	if (!config?.rankingChannelId) return 'sem-canal';

	const channel = await guild.channels.fetch(config.rankingChannelId).catch((error: unknown) => {
		if (isDiscordError(error, RESTJSONErrorCodes.UnknownChannel)) return null;
		throw error;
	});
	if (!channel?.isTextBased()) {
		await prisma.guildConfig.update({ where: { guildId: guild.id }, data: { rankingChannelId: null, rankingMessageId: null } });
		container.logger.warn('[ranking] O canal do ranking não existe mais; configuração removida. Use /admin ranking canal para definir outro.');
		return 'canal-removido';
	}

	const embeds = await buildRankingEmbeds(guild);
	const rendered = JSON.stringify(embeds.map((embed) => embed.data.description));
	if (!force && config.rankingMessageId && rendered === lastRendered) return 'sem-mudanca';

	const message = config.rankingMessageId
		? await channel.messages.fetch(config.rankingMessageId).catch((error: unknown) => {
				if (isDiscordError(error, RESTJSONErrorCodes.UnknownMessage)) return null;
				throw error;
			})
		: null;

	if (message) {
		await message.edit({ embeds });
		lastRendered = rendered;
		return 'editada';
	}

	const created = await channel.send({ embeds });
	await prisma.guildConfig.update({ where: { guildId: guild.id }, data: { rankingMessageId: created.id } });
	lastRendered = rendered;
	container.logger.info('[ranking] Mensagem do ranking publicada.');
	return 'recriada';
}
