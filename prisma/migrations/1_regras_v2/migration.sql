-- Regras v2 (decididas em 2026-10-12):
--   * dias contados no horário de Brasília;
--   * XP vira pontuação de atividade (mensagens + 1 XP por minuto de voz), com o histórico de voz convertido;
--   * livro-caixa de moedas, atividade por dia, registro de salas temporárias e de ações administrativas.
-- Tudo numa transação: se qualquer passo falhar, o banco volta ao estado anterior.
BEGIN;

-- Novas colunas em User
ALTER TABLE "User"
    ADD COLUMN "roleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "lastMessageXpAt" TIMESTAMP(3),
    ADD COLUMN "lastActiveDay" TEXT,
    ADD COLUMN "lastDailyDay" TEXT,
    ALTER COLUMN "isInServer" SET DEFAULT false;

-- Dias passam a ser contados em Brasília (antes eram dias UTC, que viravam às 21h)
UPDATE "User"
SET "lastActiveDay" = to_char(("lastActiveAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')
WHERE "lastActiveAt" IS NOT NULL;

UPDATE "User"
SET "lastDailyDay" = to_char(("lastDailyAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')
WHERE "lastDailyAt" IS NOT NULL;

-- Histórico de voz vira pontos: 1 XP por minuto já registrado
UPDATE "User"
SET "xp" = "xp" + ("totalVoiceSeconds" / 60)
WHERE "totalVoiceSeconds" >= 60;

-- Atividade por dia (base do ranking semanal)
CREATE TABLE "ActivityDay" (
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "voiceSeconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ActivityDay_pkey" PRIMARY KEY ("userId","day")
);
CREATE INDEX "ActivityDay_day_idx" ON "ActivityDay"("day");
ALTER TABLE "ActivityDay" ADD CONSTRAINT "ActivityDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Livro-caixa de moedas
CREATE TABLE "CoinTransaction" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "refDay" TEXT,
    "note" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoinTransaction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CoinTransaction_userId_createdAt_idx" ON "CoinTransaction"("userId", "createdAt");
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- O saldo que já existe entra como lançamento inicial, para o livro-caixa somar o mesmo que User.coins
INSERT INTO "CoinTransaction" ("userId", "amount", "reason", "note")
SELECT "id", "coins", 'saldo-inicial', 'Saldo anterior ao livro-caixa'
FROM "User"
WHERE "coins" <> 0;

-- Salas temporárias criadas pelo bot
CREATE TABLE "TempChannel" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TempChannel_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TempChannel_ownerId_idx" ON "TempChannel"("ownerId");

-- Ações administrativas
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

INSERT INTO "AuditLog" ("actorId", "action", "details")
SELECT 'sistema', 'migracao-regras-v2',
       format('XP de voz convertido para %s usuários (%s XP); saldo inicial lançado para %s usuários (%s moedas)',
              count(*) FILTER (WHERE "totalVoiceSeconds" >= 60),
              coalesce(sum("totalVoiceSeconds" / 60) FILTER (WHERE "totalVoiceSeconds" >= 60), 0),
              count(*) FILTER (WHERE "coins" <> 0),
              coalesce(sum("coins"), 0))
FROM "User";

-- Colunas que viraram derivadas ou deixaram de existir:
--   level (calculado a partir do XP), voiceJoinedAt (o tempo de voz agora é contado por minuto),
--   lastActiveDayStr (substituída por lastActiveDay) e o prefixo (o bot usa só slash commands).
ALTER TABLE "User"
    DROP COLUMN "level",
    DROP COLUMN "voiceJoinedAt",
    DROP COLUMN "lastActiveDayStr";
ALTER TABLE "GuildConfig" DROP COLUMN "prefix";
ALTER TABLE "HubChannel" ALTER COLUMN "templateName" SET DEFAULT 'Quarto de {user}';

COMMIT;
