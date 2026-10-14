import { container } from '@sapphire/framework';
import { PermissionFlagsBits, Team, type ButtonInteraction, type ChatInputCommandInteraction, type Interaction } from 'discord.js';

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
export async function isBotAdmin(interaction: Interaction): Promise<boolean> {
	if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
	return (await getOwnerIds()).has(interaction.user.id);
}

/** Se há algum cargo além do @everyone, que tem o mesmo ID do servidor e não conta. */
export function hasAnyRole(roleIds: Iterable<string>, guildId: string): boolean {
	for (const roleId of roleIds) if (roleId !== guildId) return true;
	return false;
}

/** A música é para quem tem algum cargo no servidor; administradores e donos do bot sempre podem. */
export async function canUseMusic(interaction: ChatInputCommandInteraction<'cached'> | ButtonInteraction<'cached'>): Promise<boolean> {
	return hasAnyRole(interaction.member.roles.cache.keys(), interaction.guildId) || isBotAdmin(interaction);
}
