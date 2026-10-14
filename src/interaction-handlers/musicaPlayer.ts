import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import { MessageFlags, escapeMarkdown, type ButtonInteraction } from 'discord.js';
import { parsePlayerButton, renderQueue, type PlayerAction } from '../lib/music/player.js';
import { getSession } from '../lib/music/session.js';
import { canUseMusic } from '../lib/permissions.js';

/** Os botões do player: as mesmas regras do /musica (fila livre; o resto com cargo e de dentro do canal do bot). */
export class MusicaPlayerHandler extends InteractionHandler {
	public constructor(context: InteractionHandler.LoaderContext, options: InteractionHandler.Options) {
		super(context, { ...options, interactionHandlerType: InteractionHandlerTypes.Button });
	}

	public override parse(interaction: ButtonInteraction) {
		const action = parsePlayerButton(interaction.customId);
		return action ? this.some(action) : this.none();
	}

	public async run(interaction: ButtonInteraction, action: PlayerAction) {
		const refuse = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
		if (!interaction.inCachedGuild()) return refuse('Este botão só funciona dentro do servidor.');

		const session = getSession(interaction.guildId);
		if (!session) {
			await refuse('Nada tocando.');
			// Player de uma sessão que já acabou (o bot reiniciou, por exemplo): tira os botões mortos
			return interaction.message.edit({ components: [] }).catch(() => undefined);
		}
		if (!session.ownsCard(interaction.message.id)) return refuse('Esse player é antigo; use o mais recente.');

		if (action === 'fila') {
			const view = session.view();
			if (!view.track) return refuse('Nada tocando.');
			return interaction.reply({ embeds: [renderQueue({ ...view, track: view.track })], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
		}

		if (!(await canUseMusic(interaction))) return refuse('⛔ A música é para quem tem algum cargo no servidor.');
		if (interaction.member.voice.channelId !== session.voiceChannelId) {
			return refuse(`Entre em <#${session.voiceChannelId}> para controlar a música.`);
		}
		const who = escapeMarkdown(interaction.member.displayName);

		switch (action) {
			case 'pausar':
				if (session.pause()) return interaction.deferUpdate();
				return refuse(session.paused ? 'A música já está pausada.' : session.current ? 'A música ainda está começando; tente de novo em instantes.' : 'Não há nada tocando.');
			case 'continuar':
				if (session.resume()) return interaction.deferUpdate();
				return refuse(session.paused ? 'Não consegui continuar; tente de novo.' : 'A música não está pausada.');
			case 'pular': {
				const skipped = session.skip();
				if (!skipped) return refuse('Não há nada tocando.');
				session.notify(`⏭️ **${who}** pulou **${escapeMarkdown(skipped.title)}**.`);
				return interaction.deferUpdate();
			}
			case 'parar':
				session.destroy(`parado por ${interaction.user.username}`, `⏹️ Música parada por ${who}.`);
				return interaction.deferUpdate();
		}
	}
}
