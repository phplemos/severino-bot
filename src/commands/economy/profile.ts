import { Command } from '@sapphire/framework';
import { EmbedBuilder, Message, ChatInputCommandInteraction } from 'discord.js';
import { getOrCreateUser } from '../../lib/user.js';

export class ProfileCommand extends Command {
	public constructor(context: Command.Context, options: Command.Options) {
		super(context, {
			...options,
			name: 'profile',
			aliases: ['bal', 'balance', 'level'],
			description: 'Check your profile status'
		});
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder //
				.setName(this.name)
				.setDescription(this.description)
		);
	}

	public override async messageRun(message: Message) {
		const user = await getOrCreateUser(message.author.id);
		const embed = this.createProfileEmbed(message.author.username, message.author.displayAvatarURL(), user);
		return message.reply({ embeds: [embed] });
	}

	public override async chatInputRun(interaction: ChatInputCommandInteraction) {
		const user = await getOrCreateUser(interaction.user.id);
		const embed = this.createProfileEmbed(interaction.user.username, interaction.user.displayAvatarURL(), user);
		return interaction.reply({ embeds: [embed] });
	}

	private createProfileEmbed(username: string, avatarUrl: string, userData: any) {
		return new EmbedBuilder()
			.setTitle(`${username}'s Profile`)
			.setThumbnail(avatarUrl)
			.addFields(
				{ name: '💰 Coins', value: userData.coins.toString(), inline: true },
				{ name: '⭐ Level', value: userData.level.toString(), inline: true },
				{ name: '📈 XP', value: userData.xp.toString(), inline: true }
			)
			.setColor('Blue')
			.setTimestamp();
	}
}
