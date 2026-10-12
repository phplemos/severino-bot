import { Command } from '@sapphire/framework';
import { GuildMember } from 'discord.js';
import { upsertMember } from '../lib/members.js';
import { buildProfileEmbed } from '../lib/profile.js';

export class PerfilCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, { ...options, name: 'perfil', description: 'Mostra seu nível, XP, moedas e tempo de voz', preconditions: ['GuildOnly'] });
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) => builder.setName(this.name).setDescription(this.description));
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const member = interaction.member instanceof GuildMember ? interaction.member : await interaction.guild!.members.fetch(interaction.user.id);
		const user = await upsertMember(member);
		const embed = await buildProfileEmbed({ displayName: member.displayName, avatarUrl: member.displayAvatarURL() }, user);
		return interaction.reply({ embeds: [embed] });
	}
}
