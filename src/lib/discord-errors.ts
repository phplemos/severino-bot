import { DiscordAPIError } from 'discord.js';

/** Verdadeiro se o erro é uma resposta da API do Discord com o código informado. */
export function isDiscordError(error: unknown, code: number): boolean {
	return error instanceof DiscordAPIError && error.code === code;
}
