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
	baseUserDirectory: 'src'
});

const main = async () => {
	try {
		client.logger.info('Logging in...');
		await client.login(process.env.DISCORD_TOKEN);
		client.logger.info('Logged in successfully!');
	} catch (error) {
		client.logger.fatal(error);
		client.destroy();
		process.exit(1);
	}
};

main();
