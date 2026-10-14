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
	type VoiceConnection,
	type VoiceConnectionState
} from '@discordjs/voice';
import { escapeMarkdown, type Guild, type GuildTextBasedChannel, type Message, type VoiceChannel, type VoiceState } from 'discord.js';
import { metrics } from '../metrics.js';
import { blockNotice, youtubeBlockedUntil } from './block.js';
import { JoinTrace, withRetry } from './join.js';
import { renderEnded, renderPlayer, type PlayerView } from './player.js';
import { hasCachedAudio, openAudio, recordFailure, type AudioHandle } from './process.js';
import { TrackQueue, type Track } from './queue.js';
import { failureMessage } from './ytdlp.js';

export const IDLE_LEAVE_MS = 5 * 60_000;
export const ALONE_LEAVE_MS = 2 * 60_000;
const READY_TIMEOUT_MS = 20_000;
// Uma entrada às vezes trava, e a seguinte, segundos depois, entra
const JOIN_ATTEMPTS = 2;
const JOIN_RETRY_MS = 2_000;
const RECONNECT_TIMEOUT_MS = 5_000;
// Os avisos repetem títulos de vídeo e apelidos, que podem trazer @everyone ou <@&cargo>
const NO_MENTIONS = { parse: [] };

const sessions = new Map<string, MusicSession>();
const locks = new Map<string, Promise<unknown>>();

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

/** Entra no canal; rejeita se a conexão não ficar pronta em duas tentativas de 20 s. Só chamar dentro de withSessionLock. */
export async function startSession(channel: VoiceChannel, textChannel: GuildTextBasedChannel): Promise<MusicSession> {
	const connection = await withRetry(JOIN_ATTEMPTS, JOIN_RETRY_MS, (attempt) => joinChannel(channel, attempt));
	const session = new MusicSession(channel, textChannel, connection);
	sessions.set(session.guildId, session);
	metrics.musicConnected = 1;
	container.logger.info(`[música] sessão iniciada em ${channel.name} (${channel.id})`);
	// Quem pediu pode ter saído enquanto o bot entrava
	session.checkAlone();
	return session;
}

/** Uma tentativa de entrar; se falhar, registra no log os estados por que a conexão passou e a desfaz. */
async function joinChannel(channel: VoiceChannel, attempt: number): Promise<VoiceConnection> {
	const connection = joinVoiceChannel({
		channelId: channel.id,
		guildId: channel.guild.id,
		adapterCreator: channel.guild.voiceAdapterCreator,
		selfDeaf: true
	});
	const trace = new JoinTrace();
	trace.record(connection.state);
	const onStateChange = (_: VoiceConnectionState, next: VoiceConnectionState) => trace.record(next);
	connection.on('stateChange', onStateChange);
	try {
		// Problemas de DAVE e de permissão aparecem aqui
		await entersState(connection, VoiceConnectionStatus.Ready, READY_TIMEOUT_MS);
		return connection;
	} catch (error) {
		container.logger.warn(
			`[música] Tentativa ${attempt} de ${JOIN_ATTEMPTS} de entrar em ${channel.name} (${channel.id}) falhou: ${String(error)}; estados: ${trace}`
		);
		if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
		throw error;
	} finally {
		connection.off('stateChange', onStateChange);
	}
}

/** Usado no desligamento: encerra as sessões e mata os processos de áudio. */
export function destroyAllSessions(): void {
	for (const session of [...sessions.values()]) session.destroy('bot desligando', '🔄 O bot está reiniciando; a fila se perdeu.');
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
	/** Resolve com true quando o player da faixa que acabou de começar foi publicado. */
	public cardPosted: Promise<boolean> = Promise.resolve(false);
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
	// A mensagem do player, e uma fila de operações nela para que publicar, editar e apagar não se atropelem
	private card: Message | null = null;
	private cardWork: Promise<unknown> = Promise.resolve();

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
				this.destroy('desconectado do canal de voz', '⚠️ Perdi a conexão com o canal de voz.');
			}
		});
		connection.on(VoiceConnectionStatus.Destroyed, () => this.destroy('conexão encerrada', '⚠️ A conexão com o canal de voz foi encerrada.'));
		// Erros da rede de voz; sem ouvinte, o EventEmitter lançaria e derrubaria o bot. Depois de um erro, a conexão se refaz ou cai em Disconnected
		connection.on('error', (error) => container.logger.error('[música] Erro na conexão de voz:', error));

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

	public get paused(): boolean {
		return this.player.state.status === AudioPlayerStatus.Paused;
	}

	/** O estado que o player e a fila mostram. */
	public view(): PlayerView {
		return {
			track: this.playing,
			paused: this.paused,
			voiceChannelId: this.channelId,
			queue: this.queue.list(),
			queueSize: this.queue.size,
			queueSeconds: this.queue.totalSeconds()
		};
	}

	/** Se a mensagem é o player atual; botões de players antigos não valem. */
	public ownsCard(messageId: string): boolean {
		return this.card?.id === messageId;
	}

	/** 0 = começou a tocar agora; n = posição na fila; null = fila cheia. */
	public enqueue(track: Track): number | null {
		// Numa sessão encerrada, a faixa abriria processos que ninguém mataria
		if (this.destroyed) throw new Error('A sessão de música já foi encerrada.');
		this.clearIdleTimer();
		if (this.playing === null && this.queue.size === 0) {
			this.queue.push(track);
			this.playNext();
			return 0;
		}
		const position = this.queue.push(track);
		if (position !== null) this.refreshCard();
		return position;
	}

	/** Pula a faixa atual; a próxima da fila começa no Idle. */
	public skip(): Track | null {
		const track = this.playing;
		if (track) this.player.stop(true);
		return track;
	}

	public pause(): boolean {
		if (!this.player.pause(true)) return false;
		this.refreshCard();
		return true;
	}

	public resume(): boolean {
		if (!this.player.unpause()) return false;
		this.refreshCard();
		return true;
	}

	/** Encerra a sessão; o player vira o aviso, ou o aviso vai como texto se não houver player. */
	public destroy(reason: string, notice = '⏹️ Saí do canal.'): void {
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
		this.endCard(notice);
	}

	public handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): void {
		if (newState.id === newState.client.user.id) {
			if (newState.channelId === null) return this.destroy('tirado do canal', '👋 Fui tirado do canal de voz.');
			// Movido de canal pelo Discord: segue tocando no canal novo
			this.channelId = newState.channelId;
			this.refreshCard();
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
		this.aloneTimer ??= setTimeout(() => this.destroy('sozinho no canal', '👋 Saí do canal: fiquei sozinho.'), ALONE_LEAVE_MS);
	}

	/** Aviso no canal de texto, sem menções. */
	public notify(content: string): void {
		this.textChannel
			.send({ content, allowedMentions: NO_MENTIONS })
			.catch((error: unknown) => container.logger.warn('[música] Não consegui avisar no canal de texto:', error));
	}

	/** Tira a próxima faixa da fila e começa a tocar; sem faixa, começa a contar a ociosidade. */
	private playNext(): void {
		let track = this.queue.shift() ?? null;
		// Com o YouTube em pausa, só toca o que já está no cache; o resto sai da fila de uma vez, com um aviso só
		if (youtubeBlockedUntil()) {
			let skipped = 0;
			while (track && !hasCachedAudio(track.id)) {
				skipped++;
				track = this.queue.shift() ?? null;
			}
			if (skipped > 0) this.notify(`⏭️ Tirei ${skipped} música(s) da fila que ainda não estão no cache. ${blockNotice()}`);
		}
		this.playing = track;
		if (!track) {
			this.idleTimer ??= setTimeout(() => this.destroy('fila vazia por 5 minutos', '👋 Saí do canal: nada tocou nos últimos 5 minutos.'), IDLE_LEAVE_MS);
			this.refreshCard();
			return;
		}

		this.handle = openAudio(track);
		this.player.play(createAudioResource(this.handle.stream, { inputType: StreamType.OggOpus, metadata: track }));
		metrics.musicTracksStarted++;
		this.cardPosted = this.postCard();
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
				this.notify(`⚠️ Não consegui tocar **${escapeMarkdown(track.title)}**: ${failureMessage(failure)} ${blockNotice()}`.trimEnd());
			}
		}
		if (!this.destroyed) this.playNext();
	}

	/** Enfileira uma operação na mensagem do player; uma falha (sem permissão, mensagem apagada) só vai para o log. */
	private cardTask<T>(task: () => Promise<T>, fallback: T): Promise<T> {
		const result = this.cardWork.then(task).catch((error: unknown) => {
			container.logger.warn('[música] Falha na mensagem do player:', error);
			return fallback;
		});
		this.cardWork = result;
		return result;
	}

	/** Faixa nova: apaga o player anterior e publica outro, para ele ficar no fim do canal. */
	private postCard(): Promise<boolean> {
		return this.cardTask(async () => {
			const previous = this.card;
			this.card = null;
			await previous?.delete().catch(() => undefined);
			if (this.destroyed) return false;
			this.card = await this.textChannel.send({ ...renderPlayer(this.view()), allowedMentions: NO_MENTIONS });
			return true;
		}, false);
	}

	/** A fila mudou, a música pausou ou o bot mudou de canal: edita o player sem trocar de mensagem. */
	private refreshCard(): void {
		void this.cardTask(async () => {
			if (this.card && !this.destroyed) await this.card.edit({ ...renderPlayer(this.view()), allowedMentions: NO_MENTIONS });
		}, undefined);
	}

	private endCard(notice: string): void {
		void this.cardTask(async () => {
			const card = this.card;
			this.card = null;
			if (card) await card.edit({ ...renderEnded(notice), allowedMentions: NO_MENTIONS });
			else await this.textChannel.send({ content: notice, allowedMentions: NO_MENTIONS });
		}, undefined);
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
