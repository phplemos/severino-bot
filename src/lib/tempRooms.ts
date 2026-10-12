import { container } from '@sapphire/framework';
import { ChannelType, OverwriteType, PermissionFlagsBits, RESTJSONErrorCodes, type Guild, type GuildMember, type VoiceBasedChannel } from 'discord.js';
import type { HubChannel } from '@prisma/client';
import { isDiscordError } from './discord-errors.js';
import { metrics } from './metrics.js';
import { prisma } from './prisma.js';

export const ROOM_CREATION_COOLDOWN_MS = 30_000;
const OWNER_PERMISSIONS = [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.MuteMembers];

const lastCreation = new Map<string, number>();
const inProgress = new Set<string>();

/** Nome da sala a partir do modelo do hub. O Discord aceita até 100 caracteres. */
export function renderRoomName(template: string, displayName: string): string {
	// Substituição por função: um "$&" no apelido não pode ser interpretado como padrão especial
	const name = template.replaceAll('{user}', () => displayName).trim();
	return (name || `Quarto de ${displayName}`).slice(0, 100);
}

/**
 * Alguém entrou num hub: leva a pessoa para a sala dela, criando uma se preciso.
 * Uma sala por pessoa e no mínimo 30 s entre criações; dentro do intervalo, a criação é adiada.
 */
export async function handleHubJoin(member: GuildMember, hubChannel: VoiceBasedChannel, hub: HubChannel): Promise<void> {
	if (inProgress.has(member.id)) return;
	inProgress.add(member.id);

	try {
		const { guild } = member;
		const existing = await prisma.tempChannel.findFirst({ where: { guildId: guild.id, ownerId: member.id } });
		if (existing) {
			const room = guild.channels.cache.get(existing.id);
			if (room?.isVoiceBased()) {
				await member.voice.setChannel(room).catch(() => undefined);
				return;
			}
			await prisma.tempChannel.deleteMany({ where: { id: existing.id } });
		}

		const wait = (lastCreation.get(member.id) ?? 0) + ROOM_CREATION_COOLDOWN_MS - Date.now();
		if (wait > 0) {
			setTimeout(() => void retryIfStillInHub(guild, member.id, hub), wait).unref();
			return;
		}

		// A sala herda as permissões da categoria (privacidade) e o dono ganha controle sobre ela
		const parent = hubChannel.parent;
		const inherited = parent
			? parent.permissionOverwrites.cache
					.filter((overwrite) => overwrite.id !== member.id)
					.map((overwrite) => ({ id: overwrite.id, type: overwrite.type, allow: overwrite.allow.bitfield, deny: overwrite.deny.bitfield }))
			: [];

		const room = await guild.channels.create({
			name: renderRoomName(hub.templateName, member.displayName),
			type: ChannelType.GuildVoice,
			parent: parent?.id,
			permissionOverwrites: [...inherited, { id: member.id, type: OverwriteType.Member, allow: OWNER_PERMISSIONS }],
			reason: `Sala temporária de ${member.user.username}`
		});
		lastCreation.set(member.id, Date.now());
		metrics.roomsCreated++;
		await prisma.tempChannel.create({ data: { id: room.id, guildId: guild.id, ownerId: member.id, hubId: hub.id } });

		// Se a pessoa saiu antes de ser movida, a sala fica vazia e é apagada na hora
		await member.voice.setChannel(room).catch(() => deleteRoomIfEmpty(guild, room.id));
	} finally {
		inProgress.delete(member.id);
	}
}

async function retryIfStillInHub(guild: Guild, memberId: string, hub: HubChannel): Promise<void> {
	const member = guild.members.cache.get(memberId);
	const channel = member?.voice.channel;
	if (!member || !channel || channel.id !== hub.id) return;
	await handleHubJoin(member, channel, hub).catch((error) => container.logger.error('[salas] Falha ao criar sala adiada:', error));
}

/** Apaga a sala se ela foi criada pelo bot e não tem mais ninguém (bots não contam). */
export async function deleteRoomIfEmpty(guild: Guild, channelId: string): Promise<boolean> {
	const registered = await prisma.tempChannel.findUnique({ where: { id: channelId } });
	if (!registered) return false;

	const channel = guild.channels.cache.get(channelId);
	if (channel?.isVoiceBased() && channel.members.some((member) => !member.user.bot)) return false;

	if (channel) {
		await channel.delete('Sala temporária vazia').catch((error: unknown) => {
			if (!isDiscordError(error, RESTJSONErrorCodes.UnknownChannel)) throw error;
		});
	}
	await prisma.tempChannel.deleteMany({ where: { id: channelId } });
	metrics.roomsDeleted++;
	return true;
}

/**
 * Arruma as salas no boot e de hora em hora: apaga as que esvaziaram com o bot fora e registra
 * salas criadas antes do registro existir (canal de voz na categoria de um hub em que um membro
 * tem permissão de gerenciar o canal, que é a marca das salas criadas pelo bot).
 */
export async function reconcileRooms(guild: Guild): Promise<{ adopted: number; removed: number }> {
	const hubs = await prisma.hubChannel.findMany({ where: { guildId: guild.id } });
	const hubIds = new Set(hubs.map((hub) => hub.id));
	const registered = new Set((await prisma.tempChannel.findMany({ where: { guildId: guild.id }, select: { id: true } })).map((room) => room.id));

	let adopted = 0;
	for (const hub of hubs) {
		const categoryId = guild.channels.cache.get(hub.id)?.parentId;
		if (!categoryId) continue;

		for (const channel of guild.channels.cache.values()) {
			if (channel.parentId !== categoryId || !channel.isVoiceBased() || hubIds.has(channel.id) || registered.has(channel.id)) continue;
			const owner = channel.permissionOverwrites.cache.find(
				(overwrite) => overwrite.type === OverwriteType.Member && overwrite.allow.has(PermissionFlagsBits.ManageChannels)
			);
			if (!owner) continue;

			await prisma.tempChannel.create({ data: { id: channel.id, guildId: guild.id, ownerId: owner.id, hubId: hub.id } });
			registered.add(channel.id);
			adopted++;
		}
	}

	let removed = 0;
	for (const id of registered) if (await deleteRoomIfEmpty(guild, id)) removed++;
	return { adopted, removed };
}
