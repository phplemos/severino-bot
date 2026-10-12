const numberFormatter = new Intl.NumberFormat('pt-BR');

/** Número no formato brasileiro (11.073). */
export function formatNumber(value: number): string {
	return numberFormatter.format(value);
}

/** Duração compacta em português: "3d 4h 5min", "45min". */
export function formatDuration(totalSeconds: number): string {
	const minutesTotal = Math.floor(Math.max(0, totalSeconds) / 60);
	const days = Math.floor(minutesTotal / 1440);
	const hours = Math.floor((minutesTotal % 1440) / 60);
	const minutes = minutesTotal % 60;

	const parts: string[] = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0 || parts.length === 0) parts.push(`${minutes}min`);
	return parts.join(' ');
}
