# Severino Discord Bot

A Discord management bot built with Node.js, Sapphire Framework, and Prisma.

## Features

- **🏠 Dynamic Voice Channels**: Join a "Hub" channel to automatically create your own temporary voice room.
- **💰 Economy System**: Earn coins with `!daily` and XP by chatting. Check your status with `!profile`.
- **🧹 Moderation**: Purge messages with `!clear` and manage bot settings.

## Setup & Configuration

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment**:
   Create a `.env` file and fill in your Discord credentials:
   ```env
   DATABASE_URL="file:./dev.db"
   DISCORD_TOKEN="YOUR_DISCORD_BOT_TOKEN"
   CLIENT_ID="YOUR_CLIENT_ID"
   HUB_CHANNEL_ID="YOUR_HUB_CHANNEL_ID"
   GUILD_ID="YOUR_GUILD_ID"
   ```

3. **Initialize Database**:
   ```bash
   npx prisma db push
   ```

4. **Build the Project**:
   ```bash
   npm run build
   ```

5. **Execution Modes**:
   - **Development**: `npm run dev`
   - **Production (Direct)**: `npm run start`

### Running in Background (Systemd User Service)

To keep the bot running continuously in the background on your host:

1. **Create Systemd Service File** (`~/.config/systemd/user/severino-bot.service`):
   ```ini
   [Unit]
   Description=Severino Discord Bot
   After=network.target

   [Service]
   Type=simple
   WorkingDirectory=/home/phplemos/homelab/services/severino-bot/severino-bot
   ExecStart=/home/phplemos/.nvm/versions/node/v24.14.0/bin/node /home/phplemos/homelab/services/severino-bot/severino-bot/dist/index.js
   Restart=always
   RestartSec=5
   Environment=PATH=/home/phplemos/.nvm/versions/node/v24.14.0/bin:/usr/local/bin:/usr/bin:/bin

   [Install]
   WantedBy=default.target
   ```

2. **Enable and Start the Service**:
   ```bash
   systemctl --user daemon-reload
   systemctl --user enable severino-bot
   systemctl --user start severino-bot
   ```

3. **Service Management Commands**:
   - Check status: `systemctl --user status severino-bot`
   - View live logs: `journalctl --user -u severino-bot -f`
   - Restart bot: `systemctl --user restart severino-bot`
   - Stop bot: `systemctl --user stop severino-bot`

---

## Git & Remote Repository Workflow

To save, commit, and push updates to the GitHub remote repository (`git@github.com:phplemos/severino-bot.git`):

1. **Check Working Directory Status**:
   ```bash
   git status
   ```

2. **Stage Your Changes**:
   ```bash
   git add .
   ```

3. **Commit Changes**:
   ```bash
   git commit -m "feat: description of changes made"
   ```

4. **Push to Remote (`main` branch)**:
   ```bash
   git push origin main
   ```

---

## Bot Commands

- `!sethub <channel>`: Sets the Hub voice channel for dynamic rooms (Admin only).
- `!clear <number>`: Clears 1-100 messages (Manage Messages only).
- `!daily`: Claim your daily coin reward.
- `!profile`: View your balance, level, and XP.
- `!ping`: Basic bot responsiveness check (Default Sapphire command).
