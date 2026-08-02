import { Listener } from '@sapphire/framework';
import { Message } from 'discord.js';
import { addXp, checkAndClaimDaily } from '../lib/user.js';

export class MessageCreateListener extends Listener {
	public constructor(context: Listener.Context, options: Listener.Options) {
		super(context, {
			...options,
			event: 'messageCreate'
		});
	}

	public async run(message: Message) {
		if (message.author.bot || !message.guild) return;

		// 1. Auto-claim daily on first activity of the day
		await checkAndClaimDaily(message.author.id);

		// 2. Add random XP between 5 and 15
		const xpToAdd = Math.floor(Math.random() * 11) + 5;
		await addXp(message.author.id, xpToAdd);
	}
}
