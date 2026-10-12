import { Events, Identifiers, Listener, type ChatInputCommandDeniedPayload, type UserError } from '@sapphire/framework';
import { MessageFlags } from 'discord.js';

const PERMISSION_NAMES: Record<string, string> = {
	Administrator: 'Administrador',
	ManageChannels: 'Gerenciar canais',
	ManageMessages: 'Gerenciar mensagens',
	MoveMembers: 'Mover membros',
	ReadMessageHistory: 'Ver histórico de mensagens',
	SendMessages: 'Enviar mensagens',
	ViewChannel: 'Ver canal'
};

function missingPermissions(error: UserError): string {
	const missing = (error.context as { missing?: string[] } | undefined)?.missing ?? [];
	return missing.map((permission) => PERMISSION_NAMES[permission] ?? permission).join(', ');
}

function deniedMessage(error: UserError): string {
	switch (error.identifier) {
		case Identifiers.PreconditionUserPermissions:
		case Identifiers.PreconditionUserPermissionsNoPermissions:
			return `⛔ Você precisa da permissão **${missingPermissions(error) || 'adequada'}** para usar este comando.`;
		case Identifiers.PreconditionClientPermissions:
		case Identifiers.PreconditionClientPermissionsNoPermissions:
			return `⚠️ Eu preciso da permissão **${missingPermissions(error) || 'adequada'}** neste canal para fazer isso.`;
		case Identifiers.PreconditionGuildOnly:
			return 'Este comando só funciona dentro do servidor.';
		case Identifiers.PreconditionCooldown:
			return 'Calma! Tente de novo em alguns segundos.';
		default:
			return `⛔ ${error.message}`;
	}
}

/** O Sapphire não responde nada quando nega um comando; sem isto o Discord mostra "O aplicativo não respondeu". */
export class ChatInputCommandDeniedListener extends Listener<typeof Events.ChatInputCommandDenied> {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, { ...options, event: Events.ChatInputCommandDenied });
	}

	public async run(error: UserError, { interaction }: ChatInputCommandDeniedPayload) {
		const content = deniedMessage(error);
		if (interaction.deferred || interaction.replied) return interaction.followUp({ content, flags: MessageFlags.Ephemeral });
		return interaction.reply({ content, flags: MessageFlags.Ephemeral });
	}
}
