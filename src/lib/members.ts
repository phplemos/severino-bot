import type { Guild, GuildMember, PartialGuildMember } from 'discord.js';
import { prisma } from './prisma.js';

function memberData(member: GuildMember) {
	// O cargo @everyone tem o mesmo ID do servidor
	const roles = member.roles.cache.filter((role) => role.id !== member.guild.id);
	return {
		username: member.user.username,
		displayName: member.displayName,
		avatar: member.displayAvatarURL(),
		isBot: member.user.bot,
		isInServer: true,
		joinedAt: member.joinedAt,
		accountCreatedAt: member.user.createdAt,
		premiumSince: member.premiumSince,
		roles: roles.map((role) => role.name),
		roleIds: roles.map((role) => role.id)
	};
}

/** Grava ou atualiza os dados de um membro. */
export async function upsertMember(member: GuildMember) {
	const data = memberData(member);
	return prisma.user.upsert({ where: { id: member.id }, update: data, create: { id: member.id, ...data } });
}

/** Marca um membro como fora do servidor. Os dados dele continuam guardados. */
export async function markMemberLeft(member: GuildMember | PartialGuildMember): Promise<void> {
	await prisma.user.updateMany({ where: { id: member.id }, data: { isInServer: false } });
}

/**
 * Sincroniza todos os membros e marca como fora quem saiu enquanto o bot estava desligado
 * (o evento de saída, nesse caso, nunca chega).
 */
export async function syncGuildMembers(guild: Guild): Promise<{ synced: number; left: number }> {
	const members = await guild.members.fetch();
	for (const member of members.values()) await upsertMember(member);

	const { count: left } = await prisma.user.updateMany({
		where: { isInServer: true, id: { notIn: [...members.keys()] } },
		data: { isInServer: false }
	});
	return { synced: members.size, left };
}
