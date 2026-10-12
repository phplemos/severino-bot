import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DAILY_REWARD, claimDaily, creditVoice, grantMessageXp, registerActivity, resetActivityCache } from '../src/lib/activity.js';
import { prisma } from '../src/lib/prisma.js';
import { topGeneral, topWeekly } from '../src/lib/ranking.js';

// Precisa de um Postgres com as migrações aplicadas: TEST_DATABASE_URL=postgresql://... npm test
describe.skipIf(!process.env.TEST_DATABASE_URL)('regras no banco', () => {
	beforeEach(async () => {
		resetActivityCache();
		await prisma.$executeRawUnsafe(
			'TRUNCATE "ActivityDay", "CoinTransaction", "TempChannel", "AuditLog", "Warning", "HubChannel", "GuildConfig", "User" RESTART IDENTITY CASCADE'
		);
	});

	afterAll(async () => {
		await prisma.$disconnect();
	});

	const user = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });
	const ledgerSum = async (id: string) => (await prisma.coinTransaction.aggregate({ where: { userId: id }, _sum: { amount: true } }))._sum.amount ?? 0;

	it('paga o daily e conta o dia uma vez só, mesmo com dez atividades simultâneas', async () => {
		const now = new Date('2026-10-12T15:00:00Z');
		const rewards = await Promise.all(Array.from({ length: 10 }, () => registerActivity('ana', now)));

		expect(rewards.filter((reward) => reward > 0)).toEqual([DAILY_REWARD]);
		const row = await user('ana');
		expect(row.coins).toBe(DAILY_REWARD);
		expect(row.activeDaysCount).toBe(1);
		expect(row.lastDailyDay).toBe('2026-10-12');
		expect(await ledgerSum('ana')).toBe(row.coins);
	});

	it('vira o dia à meia-noite de Brasília', async () => {
		await registerActivity('ana', new Date('2026-10-12T22:00:00Z')); // 19h
		expect(await registerActivity('ana', new Date('2026-10-13T01:00:00Z'))).toBe(0); // 22h, mesmo dia
		expect(await registerActivity('ana', new Date('2026-10-13T03:00:00Z'))).toBe(DAILY_REWARD); // 0h, dia seguinte

		const row = await user('ana');
		expect(row.coins).toBe(2 * DAILY_REWARD);
		expect(row.activeDaysCount).toBe(2);
	});

	it('libera o daily de novo depois de um reset de admin', async () => {
		const now = new Date('2026-10-12T15:00:00Z');
		await registerActivity('ana', now);
		await prisma.user.update({ where: { id: 'ana' }, data: { lastDailyDay: null } });

		expect(await claimDaily('ana', now)).toBe(DAILY_REWARD);
		expect(await claimDaily('ana', now)).toBe(0);
		expect(await ledgerSum('ana')).toBe(2 * DAILY_REWARD);
	});

	it('dá XP de mensagem no máximo uma vez por minuto', async () => {
		const now = new Date('2026-10-12T15:00:00Z');
		await registerActivity('ana', now);
		const grants = await Promise.all(Array.from({ length: 5 }, () => grantMessageXp('ana', now)));

		const given = grants.filter((xp) => xp > 0);
		expect(given).toHaveLength(1);
		expect(given[0]).toBeGreaterThanOrEqual(5);
		expect(given[0]).toBeLessThanOrEqual(15);
		expect(await grantMessageXp('ana', new Date(now.getTime() + 59_000))).toBe(0);
		expect(await grantMessageXp('ana', new Date(now.getTime() + 60_000))).toBeGreaterThan(0);

		const day = await prisma.activityDay.findUniqueOrThrow({ where: { userId_day: { userId: 'ana', day: '2026-10-12' } } });
		expect(day.xp).toBe((await user('ana')).xp);
	});

	it('credita 1 XP e 60 s por minuto de voz e soma no dia', async () => {
		const now = new Date('2026-10-12T15:00:00Z');
		await creditVoice(['ana', 'bia'], 60, now);
		await creditVoice(['ana', 'bia'], 60, now);

		const ana = await user('ana');
		expect(ana.xp).toBe(2);
		expect(ana.totalVoiceSeconds).toBe(120);
		expect(ana.isInServer).toBe(true);
		const day = await prisma.activityDay.findUniqueOrThrow({ where: { userId_day: { userId: 'bia', day: '2026-10-12' } } });
		expect(day).toMatchObject({ xp: 2, voiceSeconds: 120 });
	});

	it('monta o ranking geral só com membros atuais, humanos e com pontos, sem empates arbitrários', async () => {
		await prisma.user.createMany({
			data: [
				{ id: '1', displayName: 'Ana', xp: 50, totalVoiceSeconds: 10, isInServer: true },
				{ id: '2', displayName: 'Bia', xp: 50, totalVoiceSeconds: 99, isInServer: true },
				{ id: '3', displayName: 'Ex-membro', xp: 900, isInServer: false },
				{ id: '4', displayName: 'Bot', xp: 900, isInServer: true, isBot: true },
				{ id: '5', displayName: 'Zerado', xp: 0, isInServer: true }
			]
		});

		expect((await topGeneral()).map((entry) => entry.name)).toEqual(['Bia', 'Ana']);
	});

	it('monta o ranking da semana só com a atividade desde segunda-feira', async () => {
		await prisma.user.createMany({
			data: [
				{ id: '1', displayName: 'Ana', isInServer: true },
				{ id: '2', displayName: 'Bia', isInServer: true }
			]
		});
		await prisma.activityDay.createMany({
			data: [
				{ userId: '1', day: '2026-10-11', xp: 500, voiceSeconds: 0 }, // domingo: semana passada
				{ userId: '1', day: '2026-10-12', xp: 10, voiceSeconds: 600 },
				{ userId: '2', day: '2026-10-13', xp: 30, voiceSeconds: 0 }
			]
		});

		expect(await topWeekly('2026-10-12')).toEqual([
			{ id: '2', name: 'Bia', xp: 30, voiceSeconds: 0 },
			{ id: '1', name: 'Ana', xp: 10, voiceSeconds: 600 }
		]);
	});
});
