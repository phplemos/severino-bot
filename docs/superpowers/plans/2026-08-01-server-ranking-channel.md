# Server Ranking Channel & Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a live-updating server ranking channel and `/ranking` slash command.

**Architecture:** Extend Prisma schema `GuildConfig` with `rankingChannelId` and `rankingMessageId`. Create `src/lib/ranking.ts` helper to build and update the leaderboard embed. Create `/setranking` and `/ranking` slash commands.

**Tech Stack:** TypeScript, Sapphire Framework, Discord.js v14, Prisma.

## Global Constraints
- Database schema in `prisma/schema.prisma`.
- Commands in `src/commands/moderation/setranking.ts` and `src/commands/economy/ranking.ts`.
- Helper logic in `src/lib/ranking.ts`.

---

### Task 1: Update Prisma Schema & Push DB Migration

**Files:**
- Modify: `prisma/schema.prisma:36-39`

**Interfaces:**
- Consumes: `GuildConfig` model
- Produces: `rankingChannelId` and `rankingMessageId` fields on `GuildConfig`

- [ ] **Step 1: Modify `prisma/schema.prisma`**

Update `GuildConfig` in `prisma/schema.prisma`:
```prisma
model GuildConfig {
  guildId          String  @id // Discord Guild ID
  prefix           String  @default("!")
  rankingChannelId String?
  rankingMessageId String?
}
```

- [ ] **Step 2: Run Prisma DB Push**

Run: `pnpm prisma db push`
Expected: `The database is already in sync` or `SQLite database dev.db updated`.

---

### Task 2: Create Ranking Helper Module

**Files:**
- Create: `src/lib/ranking.ts`

**Interfaces:**
- Consumes: Prisma `User`, `GuildConfig`, Discord.js `Guild`, `EmbedBuilder`
- Produces: `buildRankingEmbed(guild: Guild)`, `updateGuildRanking(guild: Guild)`

- [ ] **Step 1: Create `src/lib/ranking.ts`**

```typescript
import { EmbedBuilder, Guild, TextChannel } from 'discord.js';
import { prisma } from './prisma.js';

export async function buildRankingEmbed(guild: Guild): Promise<EmbedBuilder> {
	const topUsers = await prisma.user.findMany({
		orderBy: [
			{ level: 'desc' },
			{ xp: 'desc' }
		],
		take: 10
	});

	const embed = new EmbedBuilder()
		.setTitle(`🏆 ${guild.name} - Ranking Global`)
		.setColor(0xffd700)
		.setTimestamp()
		.setFooter({ text: 'Atualizado em' });

	if (topUsers.length === 0) {
		embed.setDescription('Nenhum usuário registrado no ranking ainda.');
		return embed;
	}

	const medals = ['🥇', '🥈', '🥉'];
	const lines = await Promise.all(
		topUsers.map(async (u, index) => {
			const rankPrefix = medals[index] ?? `**#${index + 1}**`;
			let displayName = u.id;

			try {
				const member = await guild.members.fetch(u.id);
				if (member) displayName = member.displayName;
			} catch {
				// Member left or not cached, use ID
			}

			return `${rankPrefix} **${displayName}** — Nível ${u.level} | ${u.xp} XP | 💰 ${u.coins} moedas`;
		})
	);

	embed.setDescription(lines.join('\n'));
	return embed;
}

export async function updateGuildRanking(guild: Guild): Promise<void> {
	const config = await prisma.guildConfig.findUnique({
		where: { guildId: guild.id }
	});

	if (!config || !config.rankingChannelId || !config.rankingMessageId) return;

	try {
		const channel = await guild.channels.fetch(config.rankingChannelId);
		if (!channel || !channel.isTextBased()) return;

		const textChannel = channel as TextChannel;
		const message = await textChannel.messages.fetch(config.rankingMessageId);
		if (!message) return;

		const embed = await buildRankingEmbed(guild);
		await message.edit({ embeds: [embed] });
	} catch (error) {
		// Suppress error if channel/message was deleted
	}
}
```

- [ ] **Step 2: Run Build Verification**

Run: `pnpm build`
Expected: `$ tsc` exits with code 0

---

### Task 3: Create /setranking Moderation Command

**Files:**
- Create: `src/commands/moderation/setranking.ts`

**Interfaces:**
- Consumes: `/setranking` slash command input (channel), `buildRankingEmbed`, `prisma.guildConfig`
- Produces: Live ranking channel configuration

- [ ] **Step 1: Create `src/commands/moderation/setranking.ts`**

```typescript
import { Command } from '@sapphire/framework';
import { ChannelType, PermissionFlagsBits, TextChannel } from 'discord.js';
import { buildRankingEmbed } from '../../lib/ranking.js';
import { prisma } from '../../lib/prisma.js';

export class SetRankingCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, {
			...options,
			name: 'setranking',
			description: 'Define o canal para o Ranking Global auto-atualizável',
			requiredUserPermissions: [PermissionFlagsBits.ManageGuild]
		});
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addChannelOption((option) =>
					option
						.setName('channel')
						.setDescription('Canal de texto onde o ranking será publicado')
						.addChannelTypes(ChannelType.GuildText)
						.setRequired(true)
				)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const channel = interaction.options.getChannel('channel', true) as TextChannel;
		const { guild } = interaction;

		if (!guild) {
			return interaction.reply({ content: 'Este comando só pode ser usado em um servidor.', flags: ['Ephemeral'] });
		}

		await interaction.deferReply({ flags: ['Ephemeral'] });

		try {
			const embed = await buildRankingEmbed(guild);
			const rankingMsg = await channel.send({ embeds: [embed] });

			await prisma.guildConfig.upsert({
				where: { guildId: guild.id },
				update: {
					rankingChannelId: channel.id,
					rankingMessageId: rankingMsg.id
				},
				create: {
					guildId: guild.id,
					rankingChannelId: channel.id,
					rankingMessageId: rankingMsg.id
				}
			});

			return interaction.editReply({
				content: `✅ Canal de ranking configurado com sucesso em ${channel}!`
			});
		} catch (error) {
			this.container.logger.error('Erro ao configurar canal de ranking:', error);
			return interaction.editReply({
				content: '❌ Ocorreu um erro ao enviar a mensagem de ranking no canal especificado.'
			});
		}
	}
}
```

- [ ] **Step 2: Run Build Verification**

Run: `pnpm build`
Expected: `$ tsc` exits with code 0

---

### Task 4: Create /ranking Slash Command & Hook Daily Reward Updates

**Files:**
- Create: `src/commands/economy/ranking.ts`
- Modify: `src/listeners/voiceStateUpdate.ts`

**Interfaces:**
- Consumes: `/ranking` slash command input, `buildRankingEmbed`, `updateGuildRanking`
- Produces: Instant user ranking response & auto updates on daily claim

- [ ] **Step 1: Create `src/commands/economy/ranking.ts`**

```typescript
import { Command } from '@sapphire/framework';
import { buildRankingEmbed } from '../../lib/ranking.js';

export class RankingCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, {
			...options,
			name: 'ranking',
			description: 'Exibe o Ranking Global de usuários do servidor'
		});
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const { guild } = interaction;
		if (!guild) {
			return interaction.reply({ content: 'Este comando só pode ser usado em um servidor.', flags: ['Ephemeral'] });
		}

		await interaction.deferReply();

		try {
			const embed = await buildRankingEmbed(guild);
			return interaction.editReply({ embeds: [embed] });
		} catch (error) {
			this.container.logger.error('Erro ao buscar ranking:', error);
			return interaction.editReply({ content: '❌ Ocorreu um erro ao carregar o ranking.' });
		}
	}
}
```

- [ ] **Step 2: Update `voiceStateUpdate.ts` to call `updateGuildRanking(guild)` on daily reward claim**

In `src/listeners/voiceStateUpdate.ts`:
Import `updateGuildRanking` from `../lib/ranking.js` and call it if `checkAndClaimDaily` grants a reward:
```typescript
if (reward) {
    this.container.logger.info(`Auto-granted daily reward to ${member.user.username}`);
    await updateGuildRanking(guild);
}
```

- [ ] **Step 3: Run Build Verification**

Run: `pnpm build`
Expected: `$ tsc` exits with code 0
