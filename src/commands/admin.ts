import { Command } from '@sapphire/framework';
import { ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';
import { ensureUsers, forgetActivity } from '../lib/activity.js';
import { audit } from '../lib/audit.js';
import { formatNumber } from '../lib/format.js';
import { syncGuildMembers, upsertMember } from '../lib/members.js';
import { metrics } from '../lib/metrics.js';
import { isBotAdmin } from '../lib/permissions.js';
import { prisma } from '../lib/prisma.js';
import { buildProfileEmbed } from '../lib/profile.js';
import { refreshRankingMessage } from '../lib/ranking.js';
import { formatDate, formatDateTime } from '../lib/time.js';

type Interaction = Command.ChatInputCommandInteraction;

const DEFAULT_TEMPLATE = 'Quarto de {user}';

export class AdminCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, { ...options, name: 'admin', description: 'Ferramentas de administração do Severino', preconditions: ['GuildOnly'] });
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
				.addSubcommandGroup((group) =>
					group
						.setName('usuario')
						.setDescription('Consultar e ajustar membros')
						.addSubcommand((sub) =>
							sub
								.setName('ver')
								.setDescription('Mostra o perfil completo de um membro')
								.addUserOption((option) => option.setName('membro').setDescription('Quem consultar').setRequired(true))
						)
						.addSubcommand((sub) =>
							sub
								.setName('ajustar')
								.setDescription('Soma ou subtrai moedas ou XP de um membro')
								.addUserOption((option) => option.setName('membro').setDescription('Quem ajustar').setRequired(true))
								.addStringOption((option) =>
									option
										.setName('tipo')
										.setDescription('O que ajustar')
										.setRequired(true)
										.addChoices({ name: 'Moedas', value: 'moedas' }, { name: 'XP', value: 'xp' })
								)
								.addIntegerOption((option) =>
									option
										.setName('valor')
										.setDescription('Quanto somar (negativo para subtrair)')
										.setRequired(true)
										.setMinValue(-1_000_000)
										.setMaxValue(1_000_000)
								)
								.addStringOption((option) =>
									option.setName('motivo').setDescription('Por que o ajuste está sendo feito').setRequired(true).setMaxLength(200)
								)
						)
						.addSubcommand((sub) =>
							sub
								.setName('resetar-daily')
								.setDescription('Libera de novo o daily de hoje para um membro')
								.addUserOption((option) => option.setName('membro').setDescription('Quem liberar').setRequired(true))
						)
				)
				.addSubcommandGroup((group) =>
					group
						.setName('hub')
						.setDescription('Canais de voz que criam salas temporárias')
						.addSubcommand((sub) =>
							sub
								.setName('definir')
								.setDescription('Transforma um canal de voz em hub')
								.addChannelOption((option) =>
									option.setName('canal').setDescription('Canal de voz').setRequired(true).addChannelTypes(ChannelType.GuildVoice)
								)
								.addStringOption((option) =>
									option.setName('modelo').setDescription('Nome das salas; {user} vira o apelido (padrão: Quarto de {user})').setMaxLength(90)
								)
						)
						.addSubcommand((sub) => sub.setName('listar').setDescription('Lista os hubs configurados'))
						.addSubcommand((sub) =>
							sub
								.setName('remover')
								.setDescription('Deixa de usar um canal como hub')
								.addChannelOption((option) =>
									option.setName('canal').setDescription('Canal de voz').setRequired(true).addChannelTypes(ChannelType.GuildVoice)
								)
						)
				)
				.addSubcommandGroup((group) =>
					group
						.setName('ranking')
						.setDescription('Mensagem de ranking que se atualiza sozinha')
						.addSubcommand((sub) =>
							sub
								.setName('canal')
								.setDescription('Publica o ranking num canal e o mantém atualizado')
								.addChannelOption((option) =>
									option.setName('canal').setDescription('Canal de texto').setRequired(true).addChannelTypes(ChannelType.GuildText)
								)
						)
				)
				.addSubcommand((sub) => sub.setName('sincronizar').setDescription('Sincroniza os membros do servidor com o banco'))
		);
	}

	public override async chatInputRun(interaction: Interaction) {
		if (!(await isBotAdmin(interaction))) return this.reply(interaction, '⛔ Só administradores do servidor podem usar este comando.');

		const group = interaction.options.getSubcommandGroup(false) ?? '';
		switch (`${group}/${interaction.options.getSubcommand(true)}`) {
			case 'usuario/ver':
				return this.showUser(interaction);
			case 'usuario/ajustar':
				return this.adjustUser(interaction);
			case 'usuario/resetar-daily':
				return this.resetDaily(interaction);
			case 'hub/definir':
				return this.setHub(interaction);
			case 'hub/listar':
				return this.listHubs(interaction);
			case 'hub/remover':
				return this.removeHub(interaction);
			case 'ranking/canal':
				return this.setRankingChannel(interaction);
			case '/sincronizar':
				return this.sync(interaction);
			default:
				return this.reply(interaction, 'Subcomando desconhecido.');
		}
	}

	private reply(interaction: Interaction, content: string) {
		return interaction.reply({ content, flags: MessageFlags.Ephemeral });
	}

	private async showUser(interaction: Interaction) {
		const target = interaction.options.getUser('membro', true);
		const member = await interaction.guild!.members.fetch(target.id).catch(() => null);
		const user = member ? await upsertMember(member) : await prisma.user.findUnique({ where: { id: target.id } });
		if (!user) return this.reply(interaction, `${target} ainda não tem registro no bot.`);

		const profile = await buildProfileEmbed(
			{ displayName: member?.displayName ?? target.username, avatarUrl: (member ?? target).displayAvatarURL() },
			user
		);
		const transactions = await prisma.coinTransaction.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 5 });
		const ledger = transactions
			.map((entry) => `${formatDate(entry.createdAt)} · ${entry.amount > 0 ? '+' : ''}${formatNumber(entry.amount)} · ${entry.reason}${entry.note ? ` (${entry.note})` : ''}`)
			.join('\n');

		const details = new EmbedBuilder()
			.setTitle('Dados administrativos')
			.setColor(0x99aab5)
			.addFields(
				{ name: 'ID', value: user.id, inline: true },
				{ name: 'No servidor', value: user.isInServer ? 'sim' : 'não', inline: true },
				{ name: 'Última atividade', value: user.lastActiveAt ? formatDateTime(user.lastActiveAt) : 'sem registro', inline: true },
				{ name: 'Cargos', value: (user.roles.join(', ') || 'nenhum').slice(0, 1024), inline: false },
				{ name: 'Últimos lançamentos de moedas', value: (ledger || 'nenhum').slice(0, 1024), inline: false }
			);
		return interaction.reply({ embeds: [profile, details], flags: MessageFlags.Ephemeral });
	}

	private async adjustUser(interaction: Interaction) {
		const target = interaction.options.getUser('membro', true);
		const kind = interaction.options.getString('tipo', true) as 'moedas' | 'xp';
		const amount = interaction.options.getInteger('valor', true);
		const reason = interaction.options.getString('motivo', true);
		if (amount === 0) return this.reply(interaction, 'O valor precisa ser diferente de zero.');
		if (target.bot) return this.reply(interaction, 'Bots não participam da economia.');

		await ensureUsers([target.id]);
		const total = await prisma.$transaction(async (tx) => {
			const rows =
				kind === 'moedas'
					? await tx.$queryRaw<{ total: number }[]>`
						UPDATE "User" SET "coins" = "coins" + ${amount}::int, "updatedAt" = now()
						WHERE "id" = ${target.id} AND "coins" + ${amount}::int >= 0
						RETURNING "coins" AS "total"`
					: await tx.$queryRaw<{ total: number }[]>`
						UPDATE "User" SET "xp" = "xp" + ${amount}::int, "updatedAt" = now()
						WHERE "id" = ${target.id} AND "xp" + ${amount}::int >= 0
						RETURNING "xp" AS "total"`;
			if (rows.length === 0) return null;

			if (kind === 'moedas') {
				await tx.coinTransaction.create({ data: { userId: target.id, amount, reason: 'ajuste', note: reason, actorId: interaction.user.id } });
			}
			await tx.auditLog.create({
				data: { actorId: interaction.user.id, action: `ajuste-${kind}`, targetId: target.id, details: `${amount > 0 ? '+' : ''}${amount} · ${reason}` }
			});
			return rows[0].total;
		});

		const what = kind === 'moedas' ? 'O saldo' : 'O XP';
		if (total === null) return this.reply(interaction, `${what} de ${target} ficaria negativo; nada foi alterado.`);
		const weeklyNote = kind === 'xp' ? ' O ajuste de XP não entra no ranking da semana.' : '';
		return this.reply(interaction, `✅ ${what} de ${target} mudou ${amount > 0 ? '+' : ''}${formatNumber(amount)}. Total agora: ${formatNumber(total)}.${weeklyNote}`);
	}

	private async resetDaily(interaction: Interaction) {
		const target = interaction.options.getUser('membro', true);
		const { count } = await prisma.user.updateMany({ where: { id: target.id }, data: { lastDailyDay: null } });
		if (count === 0) return this.reply(interaction, `${target} ainda não tem registro no bot.`);

		forgetActivity(target.id);
		await audit(interaction.user.id, 'resetar-daily', target.id);
		return this.reply(interaction, `✅ O daily de hoje foi liberado de novo para ${target}; sai na próxima atividade.`);
	}

	private async setHub(interaction: Interaction) {
		const channel = interaction.options.getChannel('canal', true, [ChannelType.GuildVoice]);
		const template = (interaction.options.getString('modelo') ?? DEFAULT_TEMPLATE).trim();
		if (!template.includes('{user}')) {
			return this.reply(interaction, 'O modelo precisa ter `{user}`, que vira o apelido da pessoa. Exemplo: `Quarto de {user}`.');
		}

		await prisma.hubChannel.upsert({
			where: { id: channel.id },
			update: { templateName: template },
			create: { id: channel.id, guildId: interaction.guildId!, templateName: template }
		});
		await audit(interaction.user.id, 'hub-definir', channel.id, template);
		return this.reply(interaction, `✅ ${channel} agora cria salas com o nome \`${template}\`.`);
	}

	private async listHubs(interaction: Interaction) {
		const hubs = await prisma.hubChannel.findMany({ where: { guildId: interaction.guildId! } });
		if (hubs.length === 0) return this.reply(interaction, 'Nenhum hub configurado. Use `/admin hub definir`.');

		const rooms = await prisma.tempChannel.groupBy({ by: ['hubId'], _count: { _all: true } });
		const openRooms = new Map(rooms.map((room) => [room.hubId, room._count._all]));
		const lines = hubs.map((hub) => `<#${hub.id}> · modelo \`${hub.templateName}\` · ${openRooms.get(hub.id) ?? 0} sala(s) aberta(s)`);
		return this.reply(interaction, lines.join('\n'));
	}

	private async removeHub(interaction: Interaction) {
		const channel = interaction.options.getChannel('canal', true, [ChannelType.GuildVoice]);
		const { count } = await prisma.hubChannel.deleteMany({ where: { id: channel.id } });
		if (count === 0) return this.reply(interaction, `${channel} não é um hub.`);

		await audit(interaction.user.id, 'hub-remover', channel.id);
		const envNote =
			channel.id === config.HUB_CHANNEL_ID
				? ' Atenção: ele também está no HUB_CHANNEL_ID do .env; se não houver outro hub, volta no próximo reinício até ser tirado de lá.'
				: '';
		return this.reply(interaction, `✅ ${channel} deixou de ser hub. As salas que ele criou continuam até esvaziarem.${envNote}`);
	}

	private async setRankingChannel(interaction: Interaction) {
		const channel = interaction.options.getChannel('canal', true, [ChannelType.GuildText]);
		const guild = interaction.guild!;
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const previous = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
		await prisma.guildConfig.upsert({
			where: { guildId: guild.id },
			update: { rankingChannelId: channel.id, rankingMessageId: null },
			create: { guildId: guild.id, rankingChannelId: channel.id }
		});

		// Apaga o ranking antigo para não sobrar uma mensagem parada em outro canal
		if (previous?.rankingChannelId && previous.rankingMessageId) {
			const oldChannel = await guild.channels.fetch(previous.rankingChannelId).catch(() => null);
			if (oldChannel?.isTextBased()) await oldChannel.messages.delete(previous.rankingMessageId).catch(() => undefined);
		}

		try {
			await refreshRankingMessage(guild, { force: true });
		} catch (error) {
			this.container.logger.error('[ranking] Falha ao publicar no novo canal:', error);
			return interaction.editReply(`❌ Não consegui publicar em ${channel}. Confira se eu posso ver o canal, enviar mensagens e inserir links.`);
		}

		await audit(interaction.user.id, 'ranking-canal', channel.id);
		return interaction.editReply(`✅ O ranking agora fica em ${channel} e se atualiza a cada 5 minutos.`);
	}

	private async sync(interaction: Interaction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const { synced, left } = await syncGuildMembers(interaction.guild!);
		metrics.guildMembers = synced;
		await audit(interaction.user.id, 'sincronizar', null, `${synced} membros; ${left} marcados como fora`);
		return interaction.editReply(`✅ ${synced} membros sincronizados${left > 0 ? `; ${left} marcados como fora do servidor` : ''}.`);
	}
}
