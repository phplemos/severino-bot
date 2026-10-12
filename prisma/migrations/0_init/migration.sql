-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "avatar" TEXT,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3),
    "accountCreatedAt" TIMESTAMP(3),
    "premiumSince" TIMESTAMP(3),
    "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isInServer" BOOLEAN NOT NULL DEFAULT true,
    "totalVoiceSeconds" INTEGER NOT NULL DEFAULT 0,
    "voiceJoinedAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3),
    "activeDaysCount" INTEGER NOT NULL DEFAULT 0,
    "lastActiveDayStr" TEXT,
    "coins" INTEGER NOT NULL DEFAULT 0,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "lastDailyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warning" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "moderator" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Warning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HubChannel" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "templateName" TEXT NOT NULL DEFAULT '🏠 {user}''s Room',

    CONSTRAINT "HubChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuildConfig" (
    "guildId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT '!',
    "rankingChannelId" TEXT,
    "rankingMessageId" TEXT,

    CONSTRAINT "GuildConfig_pkey" PRIMARY KEY ("guildId")
);

-- AddForeignKey
ALTER TABLE "Warning" ADD CONSTRAINT "Warning_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

