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

/** Duração de uma faixa no formato do relógio: "3:45", "1:02:03"; "?" quando não se sabe. */
export function formatTrackTime(seconds: number | null): string {
	if (seconds === null) return '?';
	const total = Math.floor(Math.max(0, seconds));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const rest = String(total % 60).padStart(2, '0');
	return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}
