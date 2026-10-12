import { Events, Listener } from '@sapphire/framework';
import type { Message } from 'discord.js';
import { config } from '../config.js';
import { grantMessageXp, registerActivity } from '../lib/activity.js';
import { metrics } from '../lib/metrics.js';

export class MessageCreateListener extends Listener<typeof Events.MessageCreate> {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, { ...options, event: Events.MessageCreate });
	}

	public async run(message: Message) {
		if (!message.inGuild() || message.guildId !== config.GUILD_ID) return;
		if (message.author.bot || message.system || message.webhookId) return;

		if ((await registerActivity(message.author.id)) > 0) metrics.dailyClaims++;
		if ((await grantMessageXp(message.author.id)) > 0) metrics.messageXpGrants++;
	}
}
