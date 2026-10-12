import { Command } from '@sapphire/framework';
import { MessageFlags } from 'discord.js';
import { DAILY_REWARD, registerActivity } from '../lib/activity.js';
import { metrics } from '../lib/metrics.js';

export class DailyCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, { ...options, name: 'daily', description: 'Mostra se o daily de hoje já saiu (ele é automático)', preconditions: ['GuildOnly'] });
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) => builder.setName(this.name).setDescription(this.description));
	}

	// Usar o comando também é atividade: se o daily ainda não saiu, sai agora
	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const reward = await registerActivity(interaction.user.id);
		if (reward > 0) {
			metrics.dailyClaims++;
			return interaction.reply({ content: `💰 Você recebeu **${reward} moedas** do daily de hoje.`, flags: MessageFlags.Ephemeral });
		}
		return interaction.reply({
			content:
				`✅ O daily de hoje (${DAILY_REWARD} moedas) já foi pago. Ele é automático: sai na primeira mensagem ou entrada em call do dia. ` +
				'O próximo libera à meia-noite, horário de Brasília.',
			flags: MessageFlags.Ephemeral
		});
	}
}
