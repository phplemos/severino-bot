import { GuildMember, Guild, User as DiscordUser } from 'discord.js';
import { prisma } from './prisma.js';

export async function getOrCreateUser(userId: string) {
	let user = await prisma.user.findUnique({
		where: { id: userId }
	});

	if (!user) {
		user = await prisma.user.create({
			data: { id: userId }
		});
	}

	return user;
}

export async function addCoins(userId: string, amount: number) {
	return prisma.user.update({
		where: { id: userId },
		data: { coins: { increment: amount } }
	});
}

export async function addXp(userId: string, amount: number) {
	const user = await getOrCreateUser(userId);
	const newXp = user.xp + amount;
	const newLevel = Math.floor(0.1 * Math.sqrt(newXp)) + 1;

	return prisma.user.update({
		where: { id: userId },
		data: { 
			xp: newXp,
			level: newLevel
		}
	});
}

/**
 * Checks if a user is eligible for a daily reward and claims it if they are.
 * @returns The reward amount if claimed, otherwise null.
 */
export async function checkAndClaimDaily(userId: string) {
	const user = await getOrCreateUser(userId);
	const now = new Date();
	
	// Check if they claimed it today (same calendar day in UTC)
	if (user.lastDailyAt) {
		const lastClaim = new Date(user.lastDailyAt);
		if (lastClaim.getUTCFullYear() === now.getUTCFullYear() &&
			lastClaim.getUTCMonth() === now.getUTCMonth() &&
			lastClaim.getUTCDate() === now.getUTCDate()) {
			return null;
		}
	}

	const reward = 100;
	await prisma.user.update({
		where: { id: userId },
		data: {
			coins: { increment: reward },
			lastDailyAt: now
		}
	});

	return reward;
}

export async function upsertUserFromMember(member: GuildMember) {
	const user = member.user;
	const roles = member.roles.cache
		.filter((r) => r.name !== '@everyone')
		.map((r) => r.name);

	return prisma.user.upsert({
		where: { id: user.id },
		update: {
			username: user.username,
			displayName: member.displayName || user.globalName || user.username,
			avatar: member.displayAvatarURL() || user.displayAvatarURL(),
			isBot: user.bot,
			joinedAt: member.joinedAt,
			accountCreatedAt: user.createdAt,
			premiumSince: member.premiumSince,
			roles,
			isInServer: true
		},
		create: {
			id: user.id,
			username: user.username,
			displayName: member.displayName || user.globalName || user.username,
			avatar: member.displayAvatarURL() || user.displayAvatarURL(),
			isBot: user.bot,
			joinedAt: member.joinedAt,
			accountCreatedAt: user.createdAt,
			premiumSince: member.premiumSince,
			roles,
			isInServer: true
		}
	});
}

export async function upsertUserFromDiscordUser(discordUser: DiscordUser) {
	return prisma.user.upsert({
		where: { id: discordUser.id },
		update: {
			username: discordUser.username,
			displayName: discordUser.globalName || discordUser.username,
			avatar: discordUser.displayAvatarURL(),
			isBot: discordUser.bot,
			accountCreatedAt: discordUser.createdAt
		},
		create: {
			id: discordUser.id,
			username: discordUser.username,
			displayName: discordUser.globalName || discordUser.username,
			avatar: discordUser.displayAvatarURL(),
			isBot: discordUser.bot,
			accountCreatedAt: discordUser.createdAt
		}
	});
}

export async function syncGuildMembers(guild: Guild) {
	const members = await guild.members.fetch();
	let syncedCount = 0;

	for (const [, member] of members) {
		await upsertUserFromMember(member);
		syncedCount++;
	}

	return syncedCount;
}

export async function recordVoiceJoin(userId: string) {
	await getOrCreateUser(userId);
	await prisma.user.update({
		where: { id: userId },
		data: { voiceJoinedAt: new Date() }
	});
}

export async function recordVoiceLeave(userId: string) {
	const user = await prisma.user.findUnique({ where: { id: userId } });
	if (!user || !user.voiceJoinedAt) return;

	const now = new Date();
	const durationSeconds = Math.floor((now.getTime() - new Date(user.voiceJoinedAt).getTime()) / 1000);

	await prisma.user.update({
		where: { id: userId },
		data: {
			totalVoiceSeconds: { increment: Math.max(0, durationSeconds) },
			voiceJoinedAt: null
		}
	});
}

export async function recordUserActivity(userId: string) {
	const user = await getOrCreateUser(userId);
	const now = new Date();
	const todayStr = now.toISOString().split('T')[0];

	const isNewDay = user.lastActiveDayStr !== todayStr;

	await prisma.user.update({
		where: { id: userId },
		data: {
			lastActiveAt: now,
			lastActiveDayStr: todayStr,
			activeDaysCount: isNewDay ? { increment: 1 } : undefined
		}
	});
}

export function calculateConnectionDays(joinedAt: Date | null | undefined): number {
	if (!joinedAt) return 0;
	const diffTime = Math.abs(Date.now() - new Date(joinedAt).getTime());
	return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

export function formatDuration(seconds: number): string {
	if (seconds <= 0) return '0m';
	const days = Math.floor(seconds / (3600 * 24));
	const hours = Math.floor((seconds % (3600 * 24)) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);

	const parts: string[] = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

	return parts.join(' ');
}
