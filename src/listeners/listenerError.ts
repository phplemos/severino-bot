import { Events, Listener } from '@sapphire/framework';
import { metrics } from '../lib/metrics.js';

/** Conta os erros em eventos para o Prometheus; o registro no log é feito pelo próprio Sapphire. */
export class ListenerErrorListener extends Listener<typeof Events.ListenerError> {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, { ...options, event: Events.ListenerError });
	}

	public run() {
		metrics.listenerErrors++;
	}
}
