import { Command } from '@sapphire/framework';
import { ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits, escapeMarkdown } from 'discord.js';
import { formatTrackTime } from '../lib/format.js';
import { recordFailure, resolveTrack } from '../lib/music/process.js';
import { parseQuery } from '../lib/music/query.js';
import { MAX_QUEUE } from '../lib/music/queue.js';
import { describeTrack, getSession, startSession, withSessionLock } from '../lib/music/session.js';
import { failureMessage } from '../lib/music/ytdlp.js';
import { canUseMusic } from '../lib/permissions.js';

type Interaction = Command.ChatInputCommandInteraction;
type GuildInteraction = Command.ChatInputCommandInteraction<'cached'>;

// As respostas repetem texto digitado e títulos de vídeo, que podem trazer @everyone ou <@&cargo>
const NO_MENTIONS = { parse: [] };
const QUEUE_PREVIEW = 10;

export class MusicaCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, {
			...options,
			name: 'musica',
			description: 'Toca músicas do YouTube no seu canal de voz',
			preconditions: ['GuildOnly'],
			cooldownDelay: 2_000
		});
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addSubcommand((sub) =>
					sub
						.setName('tocar')
						.setDescription('Toca uma música ou a coloca na fila')
						.addStringOption((option) =>
							option.setName('busca').setDescription('Nome da música ou link do YouTube').setRequired(true).setMaxLength(200)
						)
				)
				.addSubcommand((sub) => sub.setName('pular').setDescription('Pula a música que está tocando'))
				.addSubcommand((sub) => sub.setName('parar').setDescription('Para a música, limpa a fila e tira o bot do canal'))
				.addSubcommand((sub) => sub.setName('fila').setDescription('Mostra o que está tocando e o que vem depois'))
		);
	}

	public override async chatInputRun(interaction: Interaction) {
		const subcommand = interaction.options.getSubcommand(true);
		if (subcommand === 'fila') return this.showQueue(interaction);

		if (!interaction.inCachedGuild() || !(await canUseMusic(interaction))) {
			return this.refuse(interaction, '⛔ A música é para quem tem algum cargo no servidor.');
		}
		switch (subcommand) {
			case 'tocar':
				return this.play(interaction);
			case 'pular':
				return this.skip(interaction);
			case 'parar':
				return this.stop(interaction);
			default:
				return this.refuse(interaction, 'Subcomando desconhecido.');
		}
	}

	/** Recusas antes do deferReply são efêmeras, como no /admin. */
	private refuse(interaction: Interaction, content: string) {
		return interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS });
	}

	private async play(interaction: GuildInteraction) {
		const input = interaction.options.getString('busca', true);
		const channel = interaction.member.voice.channel;
		if (!channel) return this.refuse(interaction, 'Entre num canal de voz primeiro.');
		if (channel.type === ChannelType.GuildStageVoice) return this.refuse(interaction, 'Não toco em canal de palco.');
		if (channel.id === interaction.guild.afkChannelId) return this.refuse(interaction, 'Não toco no canal AFK.');
		const textChannel = interaction.channel;
		if (!textChannel) return this.refuse(interaction, 'Este comando só funciona em canais de texto do servidor.');

		// Checagem rápida, para não gastar uma resolução à toa; a decisão final fica dentro da trava
		const existing = getSession(interaction.guildId);
		if (existing && existing.voiceChannelId !== channel.id && existing.current) {
			return this.refuse(interaction, `🎶 Já estou tocando em <#${existing.voiceChannelId}>. Entre lá para pedir música.`);
		}

		const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe());
		if (!channel.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
			return this.refuse(interaction, `⚠️ Preciso das permissões Conectar e Falar em <#${channel.id}>.`);
		}
		if (!channel.joinable) return this.refuse(interaction, `⚠️ <#${channel.id}> está cheio.`);

		const query = parseQuery(input);
		if (query.kind === 'invalid') return this.refuse(interaction, 'Só aceito link do YouTube ou o nome da música.');
		if (query.kind === 'playlist') return this.refuse(interaction, 'Playlists ainda não; mande o link de um vídeo.');

		// A resolução leva alguns segundos, e o Discord só espera 3
		await interaction.deferReply();
		const answer = (content: string) => interaction.editReply({ content, allowedMentions: NO_MENTIONS });

		const resolved = await resolveTrack(query.kind === 'video' ? query.url : `ytsearch1:${query.text}`);
		if (!resolved.ok) {
			switch (resolved.reason) {
				case 'busy':
					return answer('Muita gente pedindo ao mesmo tempo. Tente de novo em alguns segundos.');
				case 'no-results':
					return answer(`Não achei nada para **${escapeMarkdown(input.trim())}**.`);
				case 'live':
					return answer('Transmissões ao vivo ainda não são suportadas.');
				case 'too-long':
					return answer('Esse vídeo passa de 30 minutos.');
				default:
					recordFailure(resolved.reason);
					return answer(failureMessage(resolved.reason));
			}
		}
		const track = { ...resolved.track, requestedBy: interaction.user.id };

		// Dois pedidos simultâneos não podem criar duas sessões nem um derrubar a do outro
		return withSessionLock(interaction.guildId, async () => {
			let session = getSession(interaction.guildId);
			if (session && session.voiceChannelId !== channel.id) {
				if (session.current) return answer(`🎶 Já estou tocando em <#${session.voiceChannelId}>. Entre lá para pedir música.`);
				session.destroy('mudou de canal');
				session = undefined;
			}
			if (!session) {
				try {
					session = await startSession(channel, textChannel);
				} catch (error) {
					this.container.logger.error(`[música] Não consegui entrar em ${channel.name} (${channel.id}):`, error);
					return answer(`⚠️ Não consegui entrar em <#${channel.id}>.`);
				}
			}

			const position = session.enqueue(track);
			if (position === null) return answer(`A fila está cheia (${MAX_QUEUE} músicas).`);
			if (position === 0) return answer(`▶️ Tocando agora: ${describeTrack(track)}`);
			return answer(`➕ Na fila (posição ${position}): ${describeTrack(track)}`);
		});
	}

	// Sem a trava do tocar: o Discord só espera 3 s pela resposta, e o tocar não tem espera entre achar a sessão e pôr na fila
	private skip(interaction: GuildInteraction) {
		const session = getSession(interaction.guildId);
		if (!session?.current) return this.refuse(interaction, 'Não há nada tocando.');
		if (interaction.member.voice.channelId !== session.voiceChannelId) {
			return this.refuse(interaction, `Entre em <#${session.voiceChannelId}> para controlar a música.`);
		}
		const skipped = session.skip();
		if (!skipped) return this.refuse(interaction, 'Não há nada tocando.');
		return interaction.reply({ content: `⏭️ Pulei **${escapeMarkdown(skipped.title)}**.`, allowedMentions: NO_MENTIONS });
	}

	private stop(interaction: GuildInteraction) {
		const session = getSession(interaction.guildId);
		if (!session) return this.refuse(interaction, 'Não há nada tocando.');
		if (interaction.member.voice.channelId !== session.voiceChannelId) {
			return this.refuse(interaction, `Entre em <#${session.voiceChannelId}> para controlar a música.`);
		}
		session.destroy(`parado por ${interaction.user.username}`);
		return interaction.reply({ content: '⏹️ Parei e saí do canal.', allowedMentions: NO_MENTIONS });
	}

	private showQueue(interaction: Interaction) {
		const session = interaction.guildId ? getSession(interaction.guildId) : undefined;
		const current = session?.current;
		if (!session || !current) return this.refuse(interaction, 'Nada tocando.');

		const next = session.queue.list(QUEUE_PREVIEW);
		const lines = next.map((track, index) => `**${index + 1}.** ${describeTrack(track)} · <@${track.requestedBy}>`);
		if (session.queue.size > next.length) lines.push(`… e mais ${session.queue.size - next.length}`);
		const totalSeconds = (current.durationSeconds ?? 0) + session.queue.totalSeconds();

		const embed = new EmbedBuilder()
			.setTitle('🎶 Fila de música')
			.setColor(0x5865f2)
			.setDescription(
				[`▶️ **Tocando agora:** ${describeTrack(current)} · <@${current.requestedBy}>`, '', lines.length > 0 ? lines.join('\n') : 'Nada na fila depois desta.'].join('\n')
			)
			.setFooter({ text: `${session.queue.size + 1} música(s) · ${formatTrackTime(totalSeconds)} no total` });
		return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS });
	}
}
