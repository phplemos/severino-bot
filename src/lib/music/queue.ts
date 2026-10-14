export interface Track {
	id: string;
	title: string;
	url: string;
	durationSeconds: number | null;
	channel: string | null;
	requestedBy: string;
}

/** Músicas esperando a vez, sem contar a que está tocando. */
export const MAX_QUEUE = 50;

/** Fila de um servidor. Fica em memória e se perde quando o bot reinicia. */
export class TrackQueue {
	private readonly tracks: Track[] = [];

	/** Posição na fila (1 = a próxima), ou null se a fila está cheia. */
	public push(track: Track): number | null {
		if (this.tracks.length >= MAX_QUEUE) return null;
		return this.tracks.push(track);
	}

	public shift(): Track | undefined {
		return this.tracks.shift();
	}

	public clear(): void {
		this.tracks.length = 0;
	}

	public get size(): number {
		return this.tracks.length;
	}

	/** As próximas faixas, na ordem em que vão tocar. */
	public list(limit = MAX_QUEUE): Track[] {
		return this.tracks.slice(0, limit);
	}

	/** Soma das durações conhecidas. */
	public totalSeconds(): number {
		return this.tracks.reduce((total, track) => total + (track.durationSeconds ?? 0), 0);
	}
}
