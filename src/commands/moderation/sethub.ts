import { Command, Args } from '@sapphire/framework';
import { PermissionFlagsBits, ChannelType, Message, ChatInputCommandInteraction, VoiceChannel } from 'discord.js';
import { prisma } from '../../lib/prisma.js';

export class SetHubCommand extends Command {
	public constructor(context: Command.Context, options: Command.Options) {
		super(context, {
			...options,
			name: 'sethub',
			description: 'Sets a Hub voice channel with a custom naming template',
			preconditions: ['GuildOnly'],
			requiredUserPermissions: [PermissionFlagsBits.Administrator]
		});
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder //
				.setName(this.name)
				.setDescription(this.description)
				.addChannelOption((option) =>
					option //
						.setName('channel')
						.setDescription('The voice channel to use as a Hub')
						.setRequired(true)
						.addChannelTypes(ChannelType.GuildVoice)
				)
				.addStringOption((option) =>
					option //
						.setName('template')
						.setDescription('Naming template. Use {user} for the username. (e.g. 🎮 {user}\'s Gaming)')
						.setRequired(false)
				)
		);
	}

	public override async messageRun(message: Message, args: Args) {
		const channel = await args.pick('guildVoiceChannel').catch(() => null);
		const template = await args.rest('string').catch(() => "🏠 {user}'s Room");

		if (!channel || channel.type !== ChannelType.GuildVoice) {
			return message.reply('Please mention a valid voice channel.');
		}

		await this.upsertHub(message.guildId!, channel.id, template);
		return message.reply(`✅ Hub set for **${channel.name}** with template: \`${template}\``);
	}

	public override async chatInputRun(interaction: ChatInputCommandInteraction) {
		const channel = interaction.options.getChannel('channel', true) as VoiceChannel;
		const template = interaction.options.getString('template') || "🏠 {user}'s Room";

		await this.upsertHub(interaction.guildId!, channel.id, template);
		return interaction.reply({ content: `✅ Hub set for **${channel.name}** with template: \`${template}\``, ephemeral: true });
	}

	private async upsertHub(guildId: string, channelId: string, templateName: string) {
		return prisma.hubChannel.upsert({
			where: { id: channelId },
			update: { templateName },
			create: { id: channelId, guildId, templateName }
		});
	}
}
