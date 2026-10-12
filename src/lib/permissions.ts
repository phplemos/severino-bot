import { container } from '@sapphire/framework';
import { PermissionFlagsBits, Team, type ChatInputCommandInteraction } from 'discord.js';

let ownerIds: Set<string> | null = null;

/** Donos do aplicativo no Discord Developer Portal: o usuário dono ou os membros do time. */
async function getOwnerIds(): Promise<Set<string>> {
	if (ownerIds) return ownerIds;
	const application = await container.client.application!.fetch();
	const owner = application.owner;
	ownerIds = new Set(owner instanceof Team ? owner.members.map((member) => member.id) : owner ? [owner.id] : []);
	return ownerIds;
}

/** Administradores do servidor e os donos do bot podem usar os comandos de administração. */
export async function isBotAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
	if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
	return (await getOwnerIds()).has(interaction.user.id);
}
