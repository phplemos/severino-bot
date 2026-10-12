/** Todas as regras de "dia" e "semana" do bot seguem o horário de Brasília. */
export const TIME_ZONE = 'America/Sao_Paulo';

const dayParts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const dateFormatter = new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, dateStyle: 'short' });
const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, dateStyle: 'short', timeStyle: 'short' });

/** Dia civil em Brasília, no formato YYYY-MM-DD. */
export function dayKey(date: Date = new Date()): string {
	const parts = Object.fromEntries(dayParts.formatToParts(date).map((part) => [part.type, part.value]));
	return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Segunda-feira da semana (horário de Brasília) que contém a data, no formato YYYY-MM-DD. */
export function weekStartKey(date: Date = new Date()): string {
	const [year, month, day] = dayKey(date).split('-').map(Number);
	const civil = new Date(Date.UTC(year, month - 1, day));
	const daysSinceMonday = (civil.getUTCDay() + 6) % 7;
	civil.setUTCDate(civil.getUTCDate() - daysSinceMonday);
	return civil.toISOString().slice(0, 10);
}

/** Data no formato brasileiro, no horário de Brasília (dd/mm/aaaa). */
export function formatDate(date: Date): string {
	return dateFormatter.format(date);
}

/** Data e hora no formato brasileiro, no horário de Brasília (dd/mm/aaaa hh:mm). */
export function formatDateTime(date: Date): string {
	return dateTimeFormatter.format(date);
}

/** "12/10" a partir de uma chave YYYY-MM-DD. */
export function formatDayKey(key: string): string {
	const [, month, day] = key.split('-');
	return `${day}/${month}`;
}

/** Dias inteiros entre uma data e agora. */
export function daysSince(date: Date, now: Date = new Date()): number {
	return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000));
}
