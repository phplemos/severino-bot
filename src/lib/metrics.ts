/** Contadores e medidores expostos em /metrics no formato do Prometheus. */
export const metrics = {
	discordReady: 0,
	discordPingMs: -1,
	guildMembers: 0,
	voiceEligibleUsers: 0,
	lastVoiceTickSeconds: 0,
	messageXpGrants: 0,
	dailyClaims: 0,
	roomsCreated: 0,
	roomsDeleted: 0,
	commandErrors: 0,
	listenerErrors: 0,
	jobErrors: 0
};

const startTimeSeconds = Math.floor(Date.now() / 1000);

type Kind = 'gauge' | 'counter';
const definitions: [name: string, kind: Kind, help: string, value: () => number][] = [
	['severino_discord_ready', 'gauge', '1 quando a conexão com o gateway do Discord está pronta.', () => metrics.discordReady],
	['severino_discord_ping_milliseconds', 'gauge', 'Latência do heartbeat do gateway.', () => metrics.discordPingMs],
	['severino_guild_members', 'gauge', 'Membros do servidor na última sincronização.', () => metrics.guildMembers],
	['severino_voice_eligible_users', 'gauge', 'Pessoas que ganharam tempo de voz no último minuto.', () => metrics.voiceEligibleUsers],
	['severino_voice_last_tick_timestamp_seconds', 'gauge', 'Hora da última contagem de voz.', () => metrics.lastVoiceTickSeconds],
	['severino_message_xp_grants_total', 'counter', 'Mensagens que renderam XP.', () => metrics.messageXpGrants],
	['severino_daily_claims_total', 'counter', 'Dailies pagos.', () => metrics.dailyClaims],
	['severino_rooms_created_total', 'counter', 'Salas temporárias criadas.', () => metrics.roomsCreated],
	['severino_rooms_deleted_total', 'counter', 'Salas temporárias apagadas.', () => metrics.roomsDeleted],
	['severino_command_errors_total', 'counter', 'Comandos que terminaram em erro.', () => metrics.commandErrors],
	['severino_listener_errors_total', 'counter', 'Eventos do Discord que terminaram em erro.', () => metrics.listenerErrors],
	['severino_job_errors_total', 'counter', 'Rotinas periódicas que terminaram em erro.', () => metrics.jobErrors],
	['process_start_time_seconds', 'gauge', 'Hora de início do processo.', () => startTimeSeconds]
];

export function renderMetrics(): string {
	return definitions.map(([name, kind, help, value]) => `# HELP ${name} ${help}\n# TYPE ${name} ${kind}\n${name} ${value()}\n`).join('');
}
