# Server Ranking & Live Leaderboard Channel Design

## Overview
This feature introduces a global server ranking system for Severino Bot. Server admins can configure a dedicated ranking channel using `/setranking #channel`, where the bot maintains an auto-updating leaderboard embed. Additionally, any member can run `/ranking` in any channel to view the current top 10 users ranked by Level, XP, and Coins.

## Proposed Changes

### 1. Prisma Schema (`prisma/schema.prisma`)
Update `GuildConfig` model to track the ranking channel and message IDs:
```prisma
model GuildConfig {
  guildId          String  @id
  prefix           String  @default("!")
  rankingChannelId String?
  rankingMessageId String?
}
```

### 2. Helper Library (`src/lib/ranking.ts`)
Create a helper module providing:
- `buildRankingEmbed(guild: Guild)`: Queries top 10 users from `User` ordered by `level DESC`, `xp DESC`, and builds a formatted Discord `EmbedBuilder`.
- `updateGuildRanking(guild: Guild)`: Reads `GuildConfig`, fetches/edits the `rankingMessageId` in `rankingChannelId` with the updated embed. If the message or channel is missing/deleted, handles error gracefully or resets config.

### 3. Moderation Command (`src/commands/moderation/setranking.ts`)
- Slash command `/setranking [channel]`.
- Requires `PermissionFlagsBits.ManageGuild`.
- Posts the initial leaderboard embed to the specified channel.
- Saves `rankingChannelId` and `rankingMessageId` into `GuildConfig`.
- Responds to the moderator with an ephemeral success message.

### 4. Economy/General Command (`src/commands/economy/ranking.ts`)
- Slash command `/ranking` (or `/leaderboard`).
- Available to all server members.
- Responds with an embed showing the top 10 ranked users on the server.

### 5. Integration Hooks
- Call `updateGuildRanking` after `checkAndClaimDaily` or when user XP/Level updates in `voiceStateUpdate` or daily claim.

## Verification Plan
1. Run `pnpm prisma db push` to apply schema updates.
2. Run `pnpm build` to verify TypeScript compilation.
3. Test slash commands `/setranking` and `/ranking`.
