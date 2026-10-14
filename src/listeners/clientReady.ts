import { Events, Listener } from '@sapphire/framework';
import type { Client, Guild } from 'discord.js';
import { config } from '../config.js';
import { creditVoice, registerActivity } from '../lib/activity.js';
import { leaveIfNotAllowed } from '../lib/guilds.js';
import { every } from '../lib/jobs.js';
import { syncGuildMembers } from '../lib/members.js';
import { metrics } from '../lib/metrics.js';
import { sweepMusicCache } from '../lib/music/process.js';
import { prisma } from '../lib/prisma.js';
import { refreshRankingMessage } from '../lib/ranking.js';
import { reconcileRooms } from '../lib/tempRooms.js';
import { eligibleVoiceUsers, snapshotGuildVoice } from '../lib/voice.js';

const MINUTE = 60_000;

export class ClientReadyListener extends Listener<typeof Events.ClientReady> {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, { ...options, once: true, event: Events.ClientReady });
	}

	public async run(client: Client<true>) {
		const { logger } = this.container;
		logger.info(`Conectado como ${client.user.tag}.`);

		for (const guild of client.guilds.cache.values()) await leaveIfNotAllowed(guild, config.GUILD_ID);

		const guild = client.guilds.cache.get(config.GUILD_ID);
		if (!guild) {
			logger.error(`O bot não está no servidor ${config.GUILD_ID}; nada a fazer até ele ser adicionado.`);
			return;
		}

		await this.step('hub do .env', () => this.seedHubFromEnv(guild));
		if (config.AUTO_SYNC_MEMBERS) await this.step('sincronização de membros', () => this.syncMembers(guild));
		await this.step('salas temporárias', () => this.reconcile(guild));

		const currentGuild = () => client.guilds.cache.get(config.GUILD_ID);
		every(MINUTE, 'voz', async () => {
			const target = currentGuild();
			if (target) await this.creditVoiceMinute(target);
		});
		every(5 * MINUTE, 'ranking', async () => {
			const target = currentGuild();
			if (target) await refreshRankingMessage(target);
		}, { runNow: true });
		every(60 * MINUTE, 'cache de música', () => sweepMusicCache(), { runNow: true });
		every(60 * MINUTE, 'reconciliação', async () => {
			const target = currentGuild();
			if (!target) return;
			if (config.AUTO_SYNC_MEMBERS) await this.syncMembers(target);
			await this.reconcile(target);
		});
		logger.info('Rotinas iniciadas: voz a cada minuto, ranking a cada 5 minutos, reconciliação e limpeza do cache de música a cada hora.');
	}

	/** Executa uma etapa do boot sem deixar a falha de uma impedir as outras. */
	private async step(name: string, task: () => Promise<void>): Promise<void> {
		try {
			await task();
		} catch (error) {
			metrics.jobErrors++;
			this.container.logger.error(`[boot] Falha em ${name}:`, error);
		}
	}

	/** O HUB_CHANNEL_ID do .env só vale como semente: cria o hub se ainda não houver nenhum. */
	private async seedHubFromEnv(guild: Guild): Promise<void> {
		if (!config.HUB_CHANNEL_ID) return;
		const hubs = await prisma.hubChannel.count({ where: { guildId: guild.id } });
		if (hubs > 0) return;
		await prisma.hubChannel.create({ data: { id: config.HUB_CHANNEL_ID, guildId: guild.id } });
		this.container.logger.info(`Hub criado a partir do .env: ${config.HUB_CHANNEL_ID}.`);
	}

	private async syncMembers(guild: Guild): Promise<void> {
		const { synced, left } = await syncGuildMembers(guild);
		metrics.guildMembers = synced;
		this.container.logger.info(`${synced} membros sincronizados${left > 0 ? `; ${left} marcados como fora do servidor` : ''}.`);
	}

	private async reconcile(guild: Guild): Promise<void> {
		const { adopted, removed } = await reconcileRooms(guild);
		if (adopted > 0 || removed > 0) this.container.logger.info(`Salas temporárias: ${adopted} registradas, ${removed} vazias apagadas.`);
	}

	/** Um minuto de voz para quem está elegível; também conta como atividade do dia (daily). */
	private async creditVoiceMinute(guild: Guild): Promise<void> {
		const eligible = eligibleVoiceUsers(snapshotGuildVoice(guild), guild.afkChannelId);
		metrics.voiceEligibleUsers = eligible.length;
		metrics.lastVoiceTickSeconds = Math.floor(Date.now() / 1000);
		if (eligible.length === 0) return;

		await creditVoice(eligible, 60);
		for (const userId of eligible) {
			if ((await registerActivity(userId)) > 0) metrics.dailyClaims++;
		}
	}
}
