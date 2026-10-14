import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from 'discord.js';
import { formatTrackTime } from '../format.js';
import type { Track } from './queue.js';

export const PLAYER_ACTIONS = ['pausar', 'continuar', 'pular', 'parar', 'fila'] as const;
export type PlayerAction = (typeof PLAYER_ACTIONS)[number];

const BUTTON_PREFIX = 'musica:';
const QUEUE_PREVIEW = 10;
const COLORS = { playing: 0x5865f2, paused: 0xfaa61a, idle: 0x99aab5 };
const BUTTONS: Record<PlayerAction, { label: string; emoji: string; style: ButtonStyle }> = {
	pausar: { label: 'Pausar', emoji: '⏸️', style: ButtonStyle.Secondary },
	continuar: { label: 'Continuar', emoji: '▶️', style: ButtonStyle.Primary },
	pular: { label: 'Pular', emoji: '⏭️', style: ButtonStyle.Secondary },
	parar: { label: 'Parar', emoji: '⏹️', style: ButtonStyle.Danger },
	fila: { label: 'Fila', emoji: '📜', style: ButtonStyle.Secondary }
};

/** O que o player mostra: a faixa atual (null com a fila vazia), se está pausada e o que vem depois. */
export interface PlayerView {
	track: Track | null;
	paused: boolean;
	voiceChannelId: string;
	queue: readonly Track[];
	queueSize: number;
	queueSeconds: number;
}

/** "**título** · 3:45", com a formatação do Discord escapada no título. */
export function describeTrack(track: Track): string {
	return `**${escapeMarkdown(track.title)}** · ${formatTrackTime(track.durationSeconds)}`;
}

export function parsePlayerButton(customId: string): PlayerAction | null {
	if (!customId.startsWith(BUTTON_PREFIX)) return null;
	const action = customId.slice(BUTTON_PREFIX.length);
	return (PLAYER_ACTIONS as readonly string[]).includes(action) ? (action as PlayerAction) : null;
}

function buttons(...actions: PlayerAction[]): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		actions.map((action) =>
			new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}${action}`).setLabel(BUTTONS[action].label).setEmoji(BUTTONS[action].emoji).setStyle(BUTTONS[action].style)
		)
	);
}

function queueFooter(view: PlayerView): string {
	return view.queueSize > 0 ? `${view.queueSize} na fila · ${formatTrackTime(view.queueSeconds)}` : 'Nada na fila';
}

/** A mensagem do player: a faixa atual, a próxima e os botões. Com a fila vazia, só sobra o Parar. */
export function renderPlayer(view: PlayerView) {
	const { track } = view;
	if (!track) {
		const embed = new EmbedBuilder()
			.setColor(COLORS.idle)
			.setAuthor({ name: '⏹️ Fila vazia' })
			.setDescription(`Peça mais com \`/musica tocar\`. Saio de <#${view.voiceChannelId}> em 5 minutos se nada tocar.`);
		return { embeds: [embed], components: [buttons('parar')] };
	}

	const next = view.queue[0];
	const embed = new EmbedBuilder()
		.setColor(view.paused ? COLORS.paused : COLORS.playing)
		.setAuthor({ name: view.paused ? '⏸️ Pausado' : '▶️ Tocando agora' })
		.setTitle(track.title.slice(0, 256))
		.setURL(track.url)
		// A capa vem do próprio YouTube, pelo ID já validado
		.setThumbnail(`https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`)
		.addFields(
			{ name: 'Duração', value: formatTrackTime(track.durationSeconds), inline: true },
			{ name: 'Pedida por', value: `<@${track.requestedBy}>`, inline: true },
			{ name: 'Canal', value: `<#${view.voiceChannelId}>`, inline: true },
			{ name: 'Próxima', value: next ? describeTrack(next) : 'Nada na fila.' }
		)
		.setFooter({ text: queueFooter(view) });
	if (track.channel) embed.setDescription(escapeMarkdown(track.channel));
	return { embeds: [embed], components: [buttons(view.paused ? 'continuar' : 'pausar', 'pular', 'parar', 'fila')] };
}

/** O player depois que o bot sai do canal: só o aviso, sem botões. */
export function renderEnded(notice: string) {
	return { embeds: [new EmbedBuilder().setColor(COLORS.idle).setDescription(notice)], components: [] };
}

/** A fila completa, para o /musica fila e o botão Fila: a faixa atual, as próximas 10 e o total. */
export function renderQueue(view: PlayerView & { track: Track }): EmbedBuilder {
	const next = view.queue.slice(0, QUEUE_PREVIEW);
	const lines = next.map((track, index) => `**${index + 1}.** ${describeTrack(track)} · <@${track.requestedBy}>`);
	if (view.queueSize > next.length) lines.push(`… e mais ${view.queueSize - next.length}`);
	const totalSeconds = (view.track.durationSeconds ?? 0) + view.queueSeconds;

	return new EmbedBuilder()
		.setTitle('🎶 Fila de música')
		.setColor(COLORS.playing)
		.setDescription(
			[
				`${view.paused ? '⏸️ **Pausado:**' : '▶️ **Tocando agora:**'} ${describeTrack(view.track)} · <@${view.track.requestedBy}>`,
				'',
				lines.length > 0 ? lines.join('\n') : 'Nada na fila depois desta.'
			].join('\n')
		)
		.setFooter({ text: `${view.queueSize + 1} música(s) · ${formatTrackTime(totalSeconds)} no total` });
}
