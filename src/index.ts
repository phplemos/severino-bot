import './lib/setup.js';
import { ApplicationCommandRegistries, LogLevel, RegisterBehavior, SapphireClient } from '@sapphire/framework';
import { GatewayIntentBits, Status } from 'discord.js';
import { config } from './config.js';
import { startHealthServer } from './lib/health.js';
import { stopJobs } from './lib/jobs.js';
import { metrics } from './lib/metrics.js';
import { destroyAllSessions } from './lib/music/session.js';
import { prisma } from './lib/prisma.js';

// Os comandos são registrados só no SDJ; o BulkOverwrite também remove comandos antigos que deixaram de existir
ApplicationCommandRegistries.setDefaultBehaviorWhenNotIdentical(RegisterBehavior.BulkOverwrite);
ApplicationCommandRegistries.setDefaultGuildIds([config.GUILD_ID]);

const client = new SapphireClient({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates],
	logger: { level: LogLevel.Info },
	loadMessageCommandListeners: false,
	baseUserDirectory: new URL('.', import.meta.url).pathname
});

const health = startHealthServer(config.HEALTH_PORT, () => client.ws.status === Status.Ready);

// Watchdog: sem gateway pronto por 5 minutos, o processo sai e o Docker o reinicia
const WATCHDOG_LIMIT_MS = 5 * 60_000;
let lastReadyAt = Date.now();
const watchdog = setInterval(() => {
	const ready = client.ws.status === Status.Ready;
	metrics.discordReady = ready ? 1 : 0;
	metrics.discordPingMs = client.ws.ping;
	if (ready) {
		lastReadyAt = Date.now();
		return;
	}
	if (Date.now() - lastReadyAt > WATCHDOG_LIMIT_MS) {
		client.logger.fatal('Sem conexão com o Discord há mais de 5 minutos; saindo para o Docker reiniciar.');
		process.exit(1);
	}
}, 30_000);

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	client.logger.info(`${signal} recebido; encerrando.`);
	setTimeout(() => process.exit(1), 10_000).unref();

	clearInterval(watchdog);
	stopJobs();
	health.close();
	// Sai dos canais de voz e mata os processos de áudio antes de desconectar
	destroyAllSessions();
	await client.destroy().catch(() => undefined);
	await prisma.$disconnect().catch(() => undefined);
	process.exit(0);
}
process.once('SIGTERM', (signal) => void shutdown(signal));
process.once('SIGINT', (signal) => void shutdown(signal));
process.on('unhandledRejection', (reason) => client.logger.error('Promise rejeitada sem tratamento:', reason));

try {
	client.logger.info('Conectando ao Discord...');
	await client.login(config.DISCORD_TOKEN);
} catch (error) {
	client.logger.fatal('Falha no login do Discord:', error);
	await prisma.$disconnect().catch(() => undefined);
	process.exit(1);
}
