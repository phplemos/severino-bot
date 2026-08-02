import { REST, Routes } from 'discord.js';
import 'dotenv/config';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId) {
	console.error('Missing DISCORD_TOKEN or CLIENT_ID in .env');
	process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

async function clearCommands() {
	try {
		console.log('🧹 Starting to clear all application commands...');

		// 1. Clear Global Commands
		console.log('Clearing global commands...');
		await rest.put(Routes.applicationCommands(clientId!), { body: [] });
		console.log('Successfully cleared global commands.');

		// 2. Clear Guild Commands (if GUILD_ID is provided)
		if (guildId) {
			console.log(`Clearing guild commands for ID: ${guildId}...`);
			await rest.put(Routes.applicationGuildCommands(clientId!, guildId), { body: [] });
			console.log('Successfully cleared guild commands.');
		}

		console.log('✅ Done! All commands have been wiped. Restart the bot to re-register the current ones.');
	} catch (error) {
		console.error('❌ Error clearing commands:', error);
	}
}

clearCommands();
