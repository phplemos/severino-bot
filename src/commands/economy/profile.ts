import { Command } from '@sapphire/framework';
import { EmbedBuilder, Message, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { getOrCreateUser, upsertUserFromMember, calculateConnectionDays, formatDuration } from '../../lib/user.js';

export class ProfileCommand extends Command {
	public constructor(context: Command.Context, options: Command.Options) {
		super(context, {
			...options,
			name: 'profile',
			aliases: ['bal', 'balance', 'level'],
			description: 'Check your profile and server connection status'
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
		let userData;
		if (message.member) {
			userData = await upsertUserFromMember(message.member);
		} else {
			userData = await getOrCreateUser(message.author.id);
		}

		const embed = this.createProfileEmbed(message.author.username, message.author.displayAvatarURL(), userData);
		return message.reply({ embeds: [embed] });
	}

	public override async chatInputRun(interaction: ChatInputCommandInteraction) {
		let userData;
		if (interaction.member && interaction.member instanceof GuildMember) {
			userData = await upsertUserFromMember(interaction.member);
		} else {
			userData = await getOrCreateUser(interaction.user.id);
		}

		const embed = this.createProfileEmbed(interaction.user.username, interaction.user.displayAvatarURL(), userData);
		return interaction.reply({ embeds: [embed] });
	}

	private createProfileEmbed(username: string, avatarUrl: string, userData: any) {
		const joinedDays = calculateConnectionDays(userData.joinedAt);
		const joinedStr = userData.joinedAt
			? `${new Date(userData.joinedAt).toLocaleDateString()} (${joinedDays} days in server)`
			: 'N/A';

		const accountCreatedStr = userData.accountCreatedAt
			? new Date(userData.accountCreatedAt).toLocaleDateString()
			: 'N/A';

		const voiceTimeStr = formatDuration(userData.totalVoiceSeconds || 0);
		const activeDaysStr = `${userData.activeDaysCount || 0} days`;

		return new EmbedBuilder()
			.setTitle(`${userData.displayName || username}'s Profile`)
			.setThumbnail(userData.avatar || avatarUrl)
			.addFields(
				{ name: '💰 Coins', value: (userData.coins || 0).toString(), inline: true },
				{ name: '⭐ Level', value: (userData.level || 1).toString(), inline: true },
				{ name: '📈 XP', value: (userData.xp || 0).toString(), inline: true },
				{ name: '📅 Joined Server', value: joinedStr, inline: false },
				{ name: '🎂 Account Created', value: accountCreatedStr, inline: true },
				{ name: '🎙️ Voice Time', value: voiceTimeStr, inline: true },
				{ name: '⚡ Active Days', value: activeDaysStr, inline: true }
			)
			.setColor('Blue')
			.setTimestamp();
	}
}
