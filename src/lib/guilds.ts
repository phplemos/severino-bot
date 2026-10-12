import { container } from '@sapphire/framework';
import type { Guild } from 'discord.js';

/** O Severino é exclusivo do SDJ: sai de qualquer outro servidor em que for adicionado. */
export async function leaveIfNotAllowed(guild: Guild, allowedGuildId: string): Promise<boolean> {
	if (guild.id === allowedGuildId) return false;
	container.logger.warn(`Saindo do servidor ${guild.name} (${guild.id}): o bot é exclusivo do servidor ${allowedGuildId}.`);
	await guild.leave();
	return true;
}
