import { randomInt } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { dayKey } from './time.js';

export const DAILY_REWARD = 100;
export const MESSAGE_XP_MIN = 5;
export const MESSAGE_XP_MAX = 15;
export const MESSAGE_XP_COOLDOWN_MS = 60_000;
export const VOICE_XP_PER_MINUTE = 1;

type Db = Prisma.TransactionClient | typeof prisma;

// Quem já teve a atividade do dia registrada; evita ir ao banco a cada mensagem.
// Só serve de atalho: a garantia de "uma vez por dia" está nas atualizações condicionais abaixo.
const registeredToday = new Map<string, string>();

/** Esquece o atalho de um usuário (usado quando um admin libera o daily de novo). */
export function forgetActivity(userId: string): void {
	registeredToday.delete(userId);
}

/** Limpa todos os atalhos; só para testes. */
export function resetActivityCache(): void {
	registeredToday.clear();
}

/** Cria as linhas que faltarem: quem gera atividade no servidor é membro dele. */
export async function ensureUsers(userIds: readonly string[], db: Db = prisma): Promise<void> {
	if (userIds.length === 0) return;
	await db.$executeRaw`
		INSERT INTO "User" ("id", "isInServer", "updatedAt")
		SELECT unnest(${[...userIds]}::text[]), true, now()
		ON CONFLICT ("id") DO NOTHING`;
}

async function addActivityDay(db: Db, userIds: readonly string[], day: string, xp: number, voiceSeconds: number): Promise<void> {
	await db.$executeRaw`
		INSERT INTO "ActivityDay" ("userId", "day", "xp", "voiceSeconds")
		SELECT unnest(${[...userIds]}::text[]), ${day}, ${xp}::int, ${voiceSeconds}::int
		ON CONFLICT ("userId", "day") DO UPDATE
		SET "xp" = "ActivityDay"."xp" + EXCLUDED."xp",
		    "voiceSeconds" = "ActivityDay"."voiceSeconds" + EXCLUDED."voiceSeconds"`;
}

/**
 * Paga o daily se ainda não foi pago no dia (horário de Brasília).
 * A atualização condicional trava a linha do usuário: chamadas simultâneas pagam uma vez só.
 * @returns o valor pago agora, ou 0 se o daily do dia já tinha saído.
 */
export async function claimDaily(userId: string, now: Date = new Date()): Promise<number> {
	const day = dayKey(now);
	return prisma.$transaction(async (tx) => {
		const updated = await tx.$executeRaw`
			UPDATE "User"
			SET "coins" = "coins" + ${DAILY_REWARD}::int, "lastDailyDay" = ${day}, "lastDailyAt" = ${now}, "updatedAt" = ${now}
			WHERE "id" = ${userId} AND "lastDailyDay" IS DISTINCT FROM ${day}`;
		if (updated === 0) return 0;
		await tx.coinTransaction.create({ data: { userId, amount: DAILY_REWARD, reason: 'daily', refDay: day, createdAt: now } });
		return DAILY_REWARD;
	});
}

/**
 * Registra a primeira atividade do dia: conta o dia ativo e paga o daily automaticamente.
 * Mensagem, entrada em call e minuto de voz contam como atividade.
 * @returns o valor do daily pago agora, ou 0.
 */
export async function registerActivity(userId: string, now: Date = new Date()): Promise<number> {
	const today = dayKey(now);
	if (registeredToday.get(userId) === today) return 0;

	await ensureUsers([userId]);
	await prisma.$executeRaw`
		UPDATE "User"
		SET "activeDaysCount" = "activeDaysCount" + CASE WHEN "lastActiveDay" IS DISTINCT FROM ${today} THEN 1 ELSE 0 END,
		    "lastActiveDay" = ${today}, "lastActiveAt" = ${now}, "updatedAt" = ${now}
		WHERE "id" = ${userId}`;
	const reward = await claimDaily(userId, now);
	registeredToday.set(userId, today);
	return reward;
}

/**
 * Dá de 5 a 15 XP por mensagem, no máximo uma vez por minuto por pessoa.
 * Chame depois de registerActivity, que garante a linha do usuário.
 * @returns o XP dado, ou 0 se a pessoa ainda está no intervalo.
 */
export async function grantMessageXp(userId: string, now: Date = new Date()): Promise<number> {
	const amount = randomInt(MESSAGE_XP_MIN, MESSAGE_XP_MAX + 1);
	const cutoff = new Date(now.getTime() - MESSAGE_XP_COOLDOWN_MS);
	return prisma.$transaction(async (tx) => {
		const updated = await tx.$executeRaw`
			UPDATE "User"
			SET "xp" = "xp" + ${amount}::int, "lastMessageXpAt" = ${now}, "lastActiveAt" = ${now}, "updatedAt" = ${now}
			WHERE "id" = ${userId} AND ("lastMessageXpAt" IS NULL OR "lastMessageXpAt" <= ${cutoff})`;
		if (updated === 0) return 0;
		await addActivityDay(tx, [userId], dayKey(now), amount, 0);
		return amount;
	});
}

/** Credita um intervalo de voz (em segundos) a quem está elegível: 1 XP por minuto. */
export async function creditVoice(userIds: readonly string[], seconds: number, now: Date = new Date()): Promise<void> {
	if (userIds.length === 0 || seconds <= 0) return;
	const xp = Math.floor((seconds / 60) * VOICE_XP_PER_MINUTE);
	await prisma.$transaction(async (tx) => {
		await ensureUsers(userIds, tx);
		await tx.$executeRaw`
			UPDATE "User"
			SET "xp" = "xp" + ${xp}::int, "totalVoiceSeconds" = "totalVoiceSeconds" + ${seconds}::int,
			    "lastActiveAt" = ${now}, "updatedAt" = ${now}
			WHERE "id" = ANY(${[...userIds]}::text[])`;
		await addActivityDay(tx, userIds, dayKey(now), xp, seconds);
	});
}
