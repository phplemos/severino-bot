import { Events, Listener, type ChatInputCommandErrorPayload } from '@sapphire/framework';
import { MessageFlags } from 'discord.js';
import { metrics } from '../lib/metrics.js';

/** O Sapphire já registra o erro no log; aqui a pessoa recebe uma resposta em vez de silêncio. */
export class ChatInputCommandErrorListener extends Listener<typeof Events.ChatInputCommandError> {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, { ...options, event: Events.ChatInputCommandError });
	}

	public async run(_error: unknown, { interaction }: ChatInputCommandErrorPayload) {
		metrics.commandErrors++;
		const content = '❌ Algo deu errado ao executar este comando. O erro ficou registrado; tente de novo em instantes.';
		try {
			if (interaction.deferred || interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
			else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
		} catch {
			// A interação pode ter expirado; o erro original já foi registrado
		}
	}
}
