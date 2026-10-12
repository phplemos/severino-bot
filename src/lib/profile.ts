import { EmbedBuilder } from 'discord.js';
import type { User } from '@prisma/client';
import { formatDuration, formatNumber } from './format.js';
import { levelProgress } from './levels.js';
import { prisma } from './prisma.js';
import { dayKey, daysSince, formatDate, weekStartKey } from './time.js';

export interface ProfileTarget {
	displayName: string;
	avatarUrl: string;
}

/** XP feito na semana atual (desde segunda, 0h de Brasília). */
export async function weeklyXp(userId: string): Promise<number> {
	const result = await prisma.activityDay.aggregate({ where: { userId, day: { gte: weekStartKey() } }, _sum: { xp: true } });
	return result._sum.xp ?? 0;
}

export async function buildProfileEmbed(target: ProfileTarget, user: User): Promise<EmbedBuilder> {
	const { level, current, needed } = levelProgress(user.xp);
	const dailyToday = user.lastDailyDay === dayKey();
	const joined = user.joinedAt ? `${formatDate(user.joinedAt)} (${formatNumber(daysSince(user.joinedAt))} dias)` : 'sem registro';

	return new EmbedBuilder()
		.setTitle(`Perfil de ${target.displayName}`)
		.setThumbnail(target.avatarUrl)
		.setColor(0x5865f2)
		.addFields(
			{ name: '⭐ Nível', value: `${level} (${formatNumber(current)}/${formatNumber(needed)} XP para o próximo)`, inline: false },
			{ name: '📈 XP total', value: formatNumber(user.xp), inline: true },
			{ name: '📅 XP na semana', value: formatNumber(await weeklyXp(user.id)), inline: true },
			{ name: '💰 Moedas', value: formatNumber(user.coins), inline: true },
			{ name: '🎙️ Tempo de voz', value: formatDuration(user.totalVoiceSeconds), inline: true },
			{ name: '⚡ Dias ativos', value: formatNumber(user.activeDaysCount), inline: true },
			{ name: '🎁 Daily de hoje', value: dailyToday ? 'recebido' : 'ainda não; sai na primeira atividade', inline: true },
			{ name: '🏠 No servidor desde', value: joined, inline: true },
			{ name: '🎂 Conta criada em', value: user.accountCreatedAt ? formatDate(user.accountCreatedAt) : 'sem registro', inline: true }
		)
		.setFooter({ text: 'XP: 5 a 15 por mensagem (uma vez por minuto) e 1 por minuto em call' });
}
