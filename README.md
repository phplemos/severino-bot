# Severino Discord Bot

A Discord management bot built with Node.js, Sapphire Framework, and Prisma.

## Features

- **🏠 Dynamic Voice Channels**: Join a "Hub" channel to automatically create your own temporary voice room.
- **💰 Economy System**: Earn coins with `!daily` and XP by chatting. Check your status with `!profile`.
- **🧹 Moderation**: Purge messages with `!clear` and manage bot settings.

## Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment**:
   Create a `.env` file (one has been created for you) and fill in your Discord credentials:
   - `DISCORD_TOKEN`: Your bot token from the Discord Developer Portal.
   - `CLIENT_ID`: Your bot's application ID.
   - `HUB_CHANNEL_ID`: (Optional) Default Hub channel ID. You can also set this via `!sethub`.

3. **Initialize Database**:
   ```bash
   npx prisma migrate dev --name init
   ```

4. **Build and Run**:
   - For development: `npm run dev`
   - For production: `npm run build && npm run start`

## Commands

- `!sethub <channel>`: Sets the Hub voice channel for dynamic rooms (Admin only).
- `!clear <number>`: Clears 1-100 messages (Manage Messages only).
- `!daily`: Claim your daily coin reward.
- `!profile`: View your balance, level, and XP.
- `!ping`: Basic bot responsiveness check (Default Sapphire command).
