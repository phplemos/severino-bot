import { container } from '@sapphire/framework';
import {
	AudioPlayerStatus,
	NoSubscriberBehavior,
	StreamType,
	VoiceConnectionStatus,
	createAudioPlayer,
	createAudioResource,
	entersState,
	joinVoiceChannel,
	type AudioPlayer,
	type VoiceConnection
} from '@discordjs/voice';
import { escapeMarkdown, type Guild, type GuildTextBasedChannel, type VoiceChannel, type VoiceState } from 'discord.js';
import { formatTrackTime } from '../format.js';
import { metrics } from '../metrics.js';
import { openAudio, recordFailure, type AudioHandle } from './process.js';
import { TrackQueue, type Track } from './queue.js';
import { failureMessage } from './ytdlp.js';

export const IDLE_LEAVE_MS = 5 * 60_000;
export const ALONE_LEAVE_MS = 2 * 60_000;
const READY_TIMEOUT_MS = 20_000;
const RECONNECT_TIMEOUT_MS = 5_000;

const sessions = new Map<string, MusicSession>();
const locks = new Map<string, Promise<unknown>>();

/** "**título** · 3:45", com a formatação do Discord escapada no título. */
export function describeTrack(track: Track): string {
	return `**${escapeMarkdown(track.title)}** · ${formatTrackTime(track.durationSeconds)}`;
}

export function getSession(guildId: string): MusicSession | undefined {
	return sessions.get(guildId);
}

/** Roda a tarefa sozinha no servidor: uma cadeia de promessas por guildId, que segue mesmo se uma tarefa lançar. */
export function withSessionLock<T>(guildId: string, task: () => Promise<T>): Promise<T> {
	const result = (locks.get(guildId) ?? Promise.resolve()).then(task);
	const tail = result.catch(() => undefined);
	locks.set(guildId, tail);
	void tail.then(() => {
		if (locks.get(guildId) === tail) locks.delete(guildId);
	});
	return result;
}

/** Entra no canal; rejeita se a conexão não ficar pronta em 20 s. Só chamar dentro de withSessionLock. */
export async function startSession(channel: VoiceChannel, textChannel: GuildTextBasedChannel): Promise<MusicSession> {
	const connection = joinVoiceChannel({
		channelId: channel.id,
		guildId: channel.guild.id,
		adapterCreator: channel.guild.voiceAdapterCreator,
		selfDeaf: true
	});
	try {
		// Problemas de DAVE e de permissão aparecem aqui
		await entersState(connection, VoiceConnectionStatus.Ready, READY_TIMEOUT_MS);
	} catch (error) {
		if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
		throw error;
	}

	const session = new MusicSession(channel, textChannel, connection);
	sessions.set(session.guildId, session);
	metrics.musicConnected = 1;
	container.logger.info(`[música] sessão iniciada em ${channel.name} (${channel.id})`);
	// Quem pediu pode ter saído enquanto o bot entrava
	session.checkAlone();
	return session;
}

/** Usado no desligamento: encerra as sessões e mata os processos de áudio. */
export function destroyAllSessions(): void {
	for (const session of [...sessions.values()]) session.destroy('bot desligando');
}

/** Chamado pelo listener de voz; nunca lança. */
export function onVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): void {
	try {
		sessions.get(newState.guild.id)?.handleVoiceStateUpdate(oldState, newState);
	} catch (error) {
		container.logger.error('[música] Falha ao tratar uma mudança de voz:', error);
	}
}

export class MusicSession {
	public readonly guildId: string;
	public readonly queue = new TrackQueue();
	private readonly guild: Guild;
	private readonly textChannel: GuildTextBasedChannel;
	private readonly connection: VoiceConnection;
	private readonly player: AudioPlayer;
	private channelId: string;
	private playing: Track | null = null;
	private handle: AudioHandle | null = null;
	private idleTimer: NodeJS.Timeout | null = null;
	private aloneTimer: NodeJS.Timeout | null = null;
	private destroyed = false;

	public constructor(channel: VoiceChannel, textChannel: GuildTextBasedChannel, connection: VoiceConnection) {
		this.guildId = channel.guild.id;
		this.guild = channel.guild;
		this.channelId = channel.id;
		this.textChannel = textChannel;
		this.connection = connection;
		this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
		connection.subscribe(this.player);

		connection.on(VoiceConnectionStatus.Disconnected, async () => {
			try {
				// Movido de canal ou reconectando: a própria lib se recupera
				await Promise.race([
					entersState(connection, VoiceConnectionStatus.Signalling, RECONNECT_TIMEOUT_MS),
					entersState(connection, VoiceConnectionStatus.Connecting, RECONNECT_TIMEOUT_MS)
				]);
			} catch {
				this.destroy('desconectado do canal de voz');
			}
		});
		connection.on(VoiceConnectionStatus.Destroyed, () => this.destroy('conexão encerrada'));

		this.player.on(AudioPlayerStatus.Idle, () => void this.onTrackEnd());
		// O Idle vem em seguida e cuida do resto
		this.player.on('error', (error) => container.logger.error(`[música] Erro ao tocar ${(error.resource.metadata as Track | null)?.id ?? '?'}:`, error));
	}

	public get voiceChannelId(): string {
		return this.channelId;
	}

	public get current(): Track | null {
		return this.playing;
	}

	/** 0 = começou a tocar agora; n = posição na fila; null = fila cheia. */
	public enqueue(track: Track): number | null {
		this.clearIdleTimer();
		if (this.playing === null && this.queue.size === 0) {
			this.queue.push(track);
			this.playNext({ announce: false });
			return 0;
		}
		return this.queue.push(track);
	}

	/** Pula a faixa atual; a próxima da fila começa no Idle. */
	public skip(): Track | null {
		const track = this.playing;
		if (track) this.player.stop(true);
		return track;
	}

	public destroy(reason: string): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.clearIdleTimer();
		this.clearAloneTimer();
		this.queue.clear();
		this.handle?.kill();
		this.handle = null;
		this.playing = null;
		this.player.stop(true);
		if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) this.connection.destroy();
		if (sessions.get(this.guildId) === this) sessions.delete(this.guildId);
		metrics.musicConnected = 0;
		container.logger.info(`[música] sessão encerrada: ${reason}`);
	}

	public handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): void {
		if (newState.id === newState.client.user.id) {
			if (newState.channelId === null) return this.destroy('tirado do canal');
			// Movido de canal pelo Discord: segue tocando no canal novo
			this.channelId = newState.channelId;
			return this.checkAlone();
		}
		if (oldState.channelId === this.channelId || newState.channelId === this.channelId) this.checkAlone();
	}

	/** Sem humanos no canal, sai depois de 2 minutos; se alguém voltar, fica. */
	public checkAlone(): void {
		if (this.destroyed) return;
		const botId = this.guild.client.user.id;
		const humans = this.guild.voiceStates.cache.filter((state) => {
			if (state.channelId !== this.channelId || state.id === botId) return false;
			// Quem não está no cache conta como humano: na dúvida, o bot fica
			return !(state.member?.user.bot ?? this.guild.client.users.cache.get(state.id)?.bot ?? false);
		}).size;

		if (humans > 0) return this.clearAloneTimer();
		this.aloneTimer ??= setTimeout(() => {
			this.notify('👋 Saí do canal: fiquei sozinho.');
			this.destroy('sozinho no canal');
		}, ALONE_LEAVE_MS);
	}

	/** Tira a próxima faixa da fila e começa a tocar; sem faixa, começa a contar a ociosidade. */
	private playNext({ announce }: { announce: boolean }): void {
		const track = this.queue.shift() ?? null;
		this.playing = track;
		if (!track) {
			this.idleTimer ??= setTimeout(() => {
				this.notify('👋 Saí do canal: nada tocou nos últimos 5 minutos.');
				this.destroy('fila vazia por 5 minutos');
			}, IDLE_LEAVE_MS);
			return;
		}

		this.handle = openAudio(track.url);
		this.player.play(createAudioResource(this.handle.stream, { inputType: StreamType.OggOpus, metadata: track }));
		metrics.musicTracksStarted++;
		if (announce) this.notify(`▶️ Tocando agora: ${describeTrack(track)}`);
	}

	/** A faixa acabou, foi pulada ou falhou: encerra os processos, avisa se houve falha e segue a fila. */
	private async onTrackEnd(): Promise<void> {
		const handle = this.handle;
		const track = this.playing;
		this.handle = null;
		if (handle) {
			handle.kill();
			// Como o pedido já resolve a faixa por inteiro, aqui sobram as falhas do download
			const failure = await handle.finished;
			if (failure && track) {
				recordFailure(failure);
				this.notify(`⚠️ Não consegui tocar **${escapeMarkdown(track.title)}**: ${failureMessage(failure)}`);
			}
		}
		if (!this.destroyed) this.playNext({ announce: true });
	}

	private notify(content: string): void {
		this.textChannel
			.send({ content, allowedMentions: { parse: [] } })
			.catch((error: unknown) => container.logger.warn('[música] Não consegui avisar no canal de texto:', error));
	}

	private clearIdleTimer(): void {
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.idleTimer = null;
	}

	private clearAloneTimer(): void {
		if (this.aloneTimer) clearTimeout(this.aloneTimer);
		this.aloneTimer = null;
	}
}
