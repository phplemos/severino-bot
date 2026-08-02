/*
  Warnings:

  - You are about to drop the column `hubChannelId` on the `GuildConfig` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "HubChannel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "templateName" TEXT NOT NULL DEFAULT '🏠 {user}''s Room'
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GuildConfig" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "prefix" TEXT NOT NULL DEFAULT '!'
);
INSERT INTO "new_GuildConfig" ("guildId", "prefix") SELECT "guildId", "prefix" FROM "GuildConfig";
DROP TABLE "GuildConfig";
ALTER TABLE "new_GuildConfig" RENAME TO "GuildConfig";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
