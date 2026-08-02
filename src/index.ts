import './lib/setup.js';
import { SapphireClient, ApplicationCommandRegistries, RegisterBehavior } from '@sapphire/framework';
import { GatewayIntentBits } from 'discord.js';

ApplicationCommandRegistries.setDefaultBehaviorWhenNotIdentical(RegisterBehavior.Overwrite);
if (process.env.GUILD_ID) {
	ApplicationCommandRegistries.setDefaultGuildIds([process.env.GUILD_ID]);
}

const client = new SapphireClient({
	defaultPrefix: '!',
	caseInsensitiveCommands: true,
	logger: {
		level: 30 // info
	},
	intents: [
		GatewayIntentBits.DirectMessages,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.Guilds,
		GatewayIntentBits.MessageContent,
		GatewayIntentBits.GuildVoiceStates
	],
	loadMessageCommandListeners: true,
	baseUserDirectory: new URL('.', import.meta.url).pathname
});

const main = async () => {
	try {
		client.logger.info('Logging in...');
		await client.login(process.env.DISCORD_TOKEN);
		client.logger.info('Logged in successfully!');

		if (process.env.HUB_CHANNEL_ID && process.env.GUILD_ID) {
			const { prisma } = await import('./lib/prisma.js');
			await prisma.hubChannel.upsert({
				where: { id: process.env.HUB_CHANNEL_ID },
				update: {},
				create: {
					id: process.env.HUB_CHANNEL_ID,
					guildId: process.env.GUILD_ID,
					templateName: "🏠 {user}'s Room"
				}
			});
			client.logger.info(`Auto-registered Hub Channel from .env: ${process.env.HUB_CHANNEL_ID}`);
		}
	} catch (error) {
		client.logger.fatal(error);
		client.destroy();
		process.exit(1);
	}
};


main();
