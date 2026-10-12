# Severino

Bot do servidor **SDJ** no Discord: ranking de atividade, economia de moedas, salas de voz temporárias e ferramentas de administração. Feito com [Sapphire](https://www.sapphirejs.dev/), discord.js e Prisma sobre PostgreSQL. Atende só o SDJ e sai de qualquer outro servidor em que for adicionado.

## Regras

| Regra | Como funciona |
| --- | --- |
| XP | 5 a 15 por mensagem, no máximo uma vez por minuto por pessoa, e 1 por minuto em call. |
| Voz | Conta quem está em call com pelo menos mais uma pessoa ouvindo. Não contam o canal AFK, quem está ensurdecido nem quem está sozinho. Microfone mudo conta. |
| Nível | Nível 2 aos 100 XP, 3 aos 400, 4 aos 900 (`100 × (nível − 1)²`). |
| Daily | 100 moedas, automático na primeira atividade do dia (mensagem, entrada em call ou minuto de voz). O dia vira à meia-noite de Brasília. |
| Moedas | Por enquanto só aparecem no perfil. Todo lançamento fica no livro-caixa (`CoinTransaction`). |
| Ranking | Geral (XP total) e semanal (desde segunda, 0h de Brasília). Só membros atuais, sem bots e com pontos. |
| Salas | Entrar num hub cria uma sala com o nome do modelo (padrão `Quarto de {user}`). Uma sala por pessoa, 30 s entre criações, apagada quando fica sem ninguém. Só canais criados pelo bot são apagados. |
| Dados | Os dados dos membros são guardados sem prazo; quem sai fica marcado como fora do servidor. |

## Comandos

| Comando | Quem usa | O que faz |
| --- | --- | --- |
| `/perfil` | Todos | Nível, XP total e da semana, moedas, tempo de voz, dias ativos. |
| `/ranking [periodo]` | Todos | Ranking geral e da semana. |
| `/daily` | Todos | Mostra se o daily de hoje já saiu (e paga, se ainda não). |
| `/ping` | Todos | Latência do bot. |
| `/limpar quantidade` | Gerenciar mensagens | Apaga de 1 a 100 mensagens recentes do canal. |
| `/admin usuario ver\|ajustar\|resetar-daily` | Administradores | Consulta um membro, ajusta moedas ou XP com motivo, libera o daily de novo. |
| `/admin hub definir\|listar\|remover` | Administradores | Configura os canais que criam salas. |
| `/admin ranking canal` | Administradores | Publica o ranking num canal e o mantém atualizado a cada 5 minutos. |
| `/admin sincronizar` | Administradores | Sincroniza os membros com o banco. |

Toda ação de `/admin` e `/limpar` fica registrada em `AuditLog`. Os donos do aplicativo no Developer Portal também podem usar o `/admin`.

## Como roda no homelab

O `docker-compose.yml` fica em `services/severino-bot/` do homelab, um nível acima deste repositório:

| Serviço | Papel |
| --- | --- |
| `severino-db` | PostgreSQL 16, sem porta publicada no host. |
| `severino-migrate` | Roda `prisma migrate deploy` e `scripts/db-roles.sh` e termina; o bot só sobe depois dele. |
| `severino-bot` | O bot, conectado ao banco com o papel `severino_app`, que só lê e grava dados. |
| `severino-backup` | `pg_dump` diário em `/mnt/media_storage/backups/severino`, guardado por 14 dias. |

```bash
cd services/severino-bot
docker compose up -d --build        # build, migrações e subida
docker compose logs -f severino-bot # logs
docker inspect severino-bot --format '{{.State.Health.Status}}'
```

O bot expõe `/health` e `/metrics` na porta 8080, só dentro das redes Docker. O Prometheus do homelab coleta `/metrics` e alerta se o bot cair, perder o Discord ou ficar sem backup (`services/monitoring/prometheus/rules/severino.yml`).

### Variáveis (`services/severino-bot/.env`)

| Variável | Uso |
| --- | --- |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Dono do banco: migrações e backup. |
| `APP_DB_PASSWORD` | Senha do papel `severino_app`, usado pelo bot. Só letras e números. |
| `DISCORD_TOKEN` | Token do bot. |
| `GUILD_ID` | ID do SDJ. |
| `HUB_CHANNEL_ID` | Semente do primeiro hub; depois disso, use `/admin hub`. |
| `CLIENT_ID` | Só para `npm run clear-cmds`. |
| `AUTO_SYNC_MEMBERS` | `true` sincroniza os membros no boot e de hora em hora. |

### Backup e restauração

```bash
# Backup na hora
docker compose run --rm --no-deps -e ONCE=1 severino-backup

# Restaurar um dump (o bot fica parado enquanto isso)
docker compose stop severino-bot
docker run --rm --network severino-bot_severino_net --env-file .env \
  -v /mnt/media_storage/backups/severino:/backups:ro postgres:16-alpine \
  sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -h severino-db -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner /backups/ARQUIVO.dump'
docker compose up -d   # o severino-migrate devolve os privilégios do severino_app
```

## Desenvolvimento

```bash
npm ci
npm run typecheck
npm test                     # só os testes puros
TEST_DATABASE_URL=postgresql://... npm test   # inclui os testes de banco
```

Os testes de banco precisam de um Postgres descartável com as migrações aplicadas (`DATABASE_URL=... npx prisma migrate deploy`). O CI no GitHub Actions faz isso a cada push e também confere se as migrações batem com o schema e se há vulnerabilidades conhecidas.

### Mudando o banco

1. Altere `prisma/schema.prisma`.
2. Gere a migração a partir das existentes, usando um Postgres descartável como banco-sombra:

   ```bash
   npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma \
     --shadow-database-url postgresql://... --script > prisma/migrations/2_descricao/migration.sql
   ```

3. Revise o SQL (dados que precisam ser convertidos entram no mesmo arquivo, dentro de `BEGIN; ... COMMIT;`), rode os testes e suba com `docker compose up -d --build`.

Nunca use `prisma db push` em produção: ele não guarda histórico e trava o boot quando a mudança apaga dados.
