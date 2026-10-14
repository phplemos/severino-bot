/**
 * Limita quantas tarefas rodam ao mesmo tempo, com uma espera de tamanho fixo. Serve para as
 * resoluções do yt-dlp: cada uma abre um yt-dlp e um Node, e pedidos em massa não podem multiplicá-los.
 */
export class Limiter {
	private readonly concurrency: number;
	private readonly maxWaiting: number;
	private active = 0;
	private readonly waiting: (() => void)[] = [];

	public constructor(concurrency: number, maxWaiting: number) {
		this.concurrency = concurrency;
		this.maxWaiting = maxWaiting;
	}

	/** Roda a tarefa quando houver vaga; devolve null, sem rodar, se a espera já está cheia. */
	public async run<T>(task: () => Promise<T>): Promise<T | null> {
		if (this.active < this.concurrency) this.active++;
		else if (this.waiting.length < this.maxWaiting) await new Promise<void>((resolve) => this.waiting.push(resolve));
		else return null;

		try {
			return await task();
		} finally {
			// A vaga passa direto para quem espera, na ordem de chegada
			const next = this.waiting.shift();
			if (next) next();
			else this.active--;
		}
	}
}
