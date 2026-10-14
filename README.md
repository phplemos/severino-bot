# Severino

Bot do servidor **SDJ** no Discord: ranking de atividade, economia de moedas, salas de voz temporárias, música do YouTube e ferramentas de administração. Feito com [Sapphire](https://www.sapphirejs.dev/), discord.js e Prisma sobre PostgreSQL; a música usa `@discordjs/voice`, yt-dlp e ffmpeg. Atende só o SDJ e sai de qualquer outro servidor em que for adicionado.

## Regras

| Regra | Como funciona |
| --- | --- |
| XP | 5 a 15 por mensagem, no máximo uma vez por minuto por pessoa, e 1 por minuto em call. |
| Voz | Conta quem está em call com pelo menos mais uma pessoa ouvindo. Não contam o canal AFK, quem está ensurdecido nem quem está sozinho. Microfone mudo conta. |
| Nível | Nível 2 aos 100 XP, 3 aos 400, 4 aos 900 (`100 × (nível − 1)²`). |
| Daily | 100 moedas, automático na primeira atividade do dia (mensagem, entrada em call ou minuto de voz). O dia vira à meia-noite de Brasília. |
| Moedas | Por enquanto só aparecem no perfil. Todo lançamento fica no livro-caixa (`CoinTransaction`). |
| Ranking | Geral (XP total) e semanal (desde segunda, 0h de Brasília). Só membros atuais, sem bots e com pontos. |
| Música | `/musica` toca áudio do YouTube, por link de vídeo ou busca, para quem tem algum cargo além do @everyone; administradores e donos do aplicativo sempre podem. Faixas de até 30 minutos e até 50 na fila, sem playlists nem transmissões ao vivo. O bot sai depois de 5 minutos sem nada na fila ou de 2 minutos sozinho no canal. A fila fica em memória e some quando o bot reinicia. |
| Salas | Entrar num hub cria uma sala com o nome do modelo (padrão `Quarto de {user}`). Uma sala por pessoa, 30 s entre criações, apagada quando fica sem ninguém. Só canais criados pelo bot são apagados. |
| Dados | Os dados dos membros são guardados sem prazo; quem sai fica marcado como fora do servidor. |

## Comandos

| Comando | Quem usa | O que faz |
| --- | --- | --- |
| `/perfil` | Todos | Nível, XP total e da semana, moedas, tempo de voz, dias ativos. |
| `/ranking [periodo]` | Todos | Ranking geral e da semana. |
| `/daily` | Todos | Mostra se o daily de hoje já saiu (e paga, se ainda não). |
| `/ping` | Todos | Latência do bot. |
| `/musica tocar busca` | Quem tem cargo | Toca uma música do YouTube (link ou nome) no seu canal de voz, ou a põe na fila. |
| `/musica pular\|parar` | Quem tem cargo | Pula a faixa atual; para, limpa a fila e tira o bot do canal. Só de dentro do canal do bot. |
| `/musica fila` | Todos | A faixa atual, as próximas 10 e o total. |
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

O bot expõe `/health` e `/metrics` na porta 8080, só dentro das redes Docker. O Prometheus do homelab coleta `/metrics` e alerta se o bot cair, perder o Discord, ficar sem backup, se a música falhar ou se o YouTube barrar o bot (`services/monitoring/prometheus/rules/severino.yml`).

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

### Música

O yt-dlp (versão fixada no `Dockerfile`, conferida pelo SHA-256 da release) e o ffmpeg do Alpine rodam dentro do container do bot. Cada pedido passa por um `yt-dlp -J`, uma resolução por vez e até 5 na espera; na hora de tocar, o yt-dlp baixa a faixa para um buffer de uns 40 MiB e o ffmpeg a converte em Ogg/Opus. Só links de vídeo do YouTube chegam ao yt-dlp, remontados a partir do ID; o resto vira busca (`ytsearch1:`). Sem cookies e sem conta Google.

O container tem `mem_limit: 640m`: em 14/10/2026, uma faixa baixando e uma resolução ao mesmo tempo chegaram a 389 MiB, e quem mais pesa é o Node que o yt-dlp abre para os desafios do YouTube (uns 170 MiB por extração). Falhas aparecem no log como `[música] falha (<tipo>) …` e em `severino_music_failures_total` e `severino_music_bot_checks_total`.

- **O YouTube mudou algo e as faixas falham** (alerta `SeverinoMusicaFalhando`, log `[música] falha (failure)`):
  1. Pegue a release nova do yt-dlp e o hash dela: `curl -sL https://github.com/yt-dlp/yt-dlp/releases/download/<versão>/SHA2-256SUMS | grep musllinux.zip`.
  2. Atualize `YTDLP_VERSION` e `YTDLP_SHA256` no `Dockerfile`.
  3. Rode `docker compose up -d --build`. O `update.sh` também reconstrói, mas com a versão fixada no `Dockerfile`, então só a troca do passo 2 atualiza o yt-dlp.
- **O YouTube pediu "confirme que não é robô"** (alerta `SeverinoMusicaBloqueada`, log `[música] falha (bot-check)`): o IP de casa foi marcado. Deixe a música parada por algumas horas; testes em massa (umas 60 extrações em uma hora) já bastaram para isso. Se voltar sempre, há duas saídas, ainda não implementadas:
  - um provedor de PO token (`bgutil-ytdlp-pot-provider`);
  - cookies de uma conta Google descartável, nunca a pessoal.
- **ffmpeg:** vem do Alpine, numa camada que fica em cache; rebuilds comuns, inclusive os do `update.sh`, não o atualizam. Para atualizar ffmpeg, Node e openssl de uma vez: `docker compose build --pull severino-bot && docker compose up -d`.

## Desenvolvimento

```bash
npm ci
npm run typecheck
npm test                     # só os testes puros
TEST_DATABASE_URL=postgresql://... npm test   # inclui os testes de banco
```

Os testes de banco precisam de um Postgres descartável com as migrações aplicadas (`DATABASE_URL=... npx prisma migrate deploy`). A música fora do Docker precisa de `yt-dlp` e `ffmpeg` no PATH, ou do `YTDLP_PATH` do `.env.example` apontando para um yt-dlp. O CI no GitHub Actions faz isso a cada push e também confere se as migrações batem com o schema e se há vulnerabilidades conhecidas.

### Mudando o banco

1. Altere `prisma/schema.prisma`.
2. Gere a migração a partir das existentes, usando um Postgres descartável como banco-sombra:

   ```bash
   npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma \
     --shadow-database-url postgresql://... --script > prisma/migrations/2_descricao/migration.sql
   ```

3. Revise o SQL (dados que precisam ser convertidos entram no mesmo arquivo, dentro de `BEGIN; ... COMMIT;`), rode os testes e suba com `docker compose up -d --build`.

Nunca use `prisma db push` em produção: ele não guarda histórico e trava o boot quando a mudança apaga dados.
