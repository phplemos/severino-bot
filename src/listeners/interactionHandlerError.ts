import { Events, Listener, type InteractionHandlerError } from '@sapphire/framework';
import { MessageFlags } from 'discord.js';
import { metrics } from '../lib/metrics.js';

/** Erro num botão: o Sapphire já registra no log; aqui a pessoa recebe uma resposta em vez de "A interação falhou". */
export class InteractionHandlerErrorListener extends Listener<typeof Events.InteractionHandlerError> {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, { ...options, event: Events.InteractionHandlerError });
	}

	public async run(_error: unknown, { interaction }: InteractionHandlerError) {
		metrics.commandErrors++;
		if (!interaction.isRepliable()) return;
		const content = '❌ Algo deu errado com este botão. O erro ficou registrado; tente de novo em instantes.';
		try {
			if (interaction.deferred || interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
			else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
		} catch {
			// A interação pode ter expirado; o erro original já foi registrado
		}
	}
}
