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
