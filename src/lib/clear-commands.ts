// Apaga todos os slash commands registrados (globais e do servidor). O bot registra de novo ao subir.
// Uso: npm run clear-cmds (lê DISCORD_TOKEN, CLIENT_ID e GUILD_ID do .env)
import 'dotenv/config';
import { REST, Routes } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId) {
	console.error('Faltam DISCORD_TOKEN ou CLIENT_ID no .env.');
	process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

try {
	await rest.put(Routes.applicationCommands(clientId), { body: [] });
	console.log('Comandos globais apagados.');

	if (guildId) {
		await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });
		console.log(`Comandos do servidor ${guildId} apagados.`);
	}

	console.log('Pronto. Reinicie o bot para registrar os comandos atuais.');
} catch (error) {
	console.error('Falha ao apagar os comandos:', error);
	process.exitCode = 1;
}
