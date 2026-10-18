# Operação

Como o Severino roda no homelab, como fazer backup, como a música funciona por dentro e o que fazer quando algo dá errado. A instalação está no [README](../README.md).

- [Como roda no homelab](#como-roda-no-homelab)
- [Backup e restauração](#backup-e-restauração)
- [Música por dentro](#música-por-dentro)
- [Quando a música dá problema](#quando-a-música-dá-problema)
- [Mudando o banco](#mudando-o-banco)

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

## Backup e restauração

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

## Música por dentro

O yt-dlp (versão fixada no `Dockerfile`, conferida pelo SHA-256 da release) e o ffmpeg do Alpine rodam dentro do container do bot. Cada pedido novo passa por um `yt-dlp -J`, uma resolução por vez e até 5 na espera; na hora de tocar, o yt-dlp baixa a faixa a partir desse JSON (`--load-info-json`, sem extrair de novo) para um buffer de uns 40 MiB, e o ffmpeg a converte em Ogg/Opus. Só links de vídeo do YouTube chegam ao yt-dlp, remontados a partir do ID; o resto vira busca (`ytsearch1:`). Sem cookies e sem conta Google.

No Docker, o yt-dlp sai só pelo IPv6 (`YTDLP_FORCE_IPV6=true`, com `enable_ipv6` na rede `severino_net`, que ganha um endereço interno e NAT para o IPv6 do host). Em 17/10/2026, o Google marcou o IPv4 de casa: `curl -4` no youtube.com caía em `google.com/sorry`, o yt-dlp levava 429 e "confirme que não é robô", e o mesmo pedido pelo IPv6 voltava 200. Fora do Docker, a variável fica vazia e o yt-dlp usa a rede do jeito que ela vier.

O container tem `mem_limit: 640m`: em 14/10/2026, uma faixa baixando e uma resolução ao mesmo tempo chegaram a 389 MiB, e quem mais pesa é o Node que o yt-dlp abre para os desafios do YouTube (uns 170 MiB por extração). Falhas aparecem no log como `[música] falha (<tipo>) …` e em `severino_music_failures_total` e `severino_music_bot_checks_total`.

Para entrar no canal, a conexão de voz tem 20 s para ficar pronta; se não ficar, o bot a desfaz e tenta mais uma vez 2 s depois, então "⚠️ Não consegui entrar" pode levar uns 40 s. Cada tentativa que falha vai para o log com os estados por que a conexão passou.

### Cache

Fica em `services/severino-bot/cache`, montado em `/cache` e do uid 1000.

| O que | Prazo |
| --- | --- |
| Áudio como veio do YouTube (`audio/<id>`): a faixa que já tocou toca de novo sem yt-dlp e sem YouTube | 7 dias desde o último uso, até 10 GB; acima disso saem as tocadas há mais tempo |
| Busca → vídeo (`search/`) e dados da faixa (`meta/`): o pedido repetido não chama o YouTube | 7 dias desde o último uso |
| JSON completo do pedido (`info/<id>.json`), que a hora de tocar reaproveita | 1 hora, porque os links de áudio do YouTube expiram; um download que falha o apaga na hora |
| Scripts do player do YouTube que o próprio yt-dlp guarda (`yt-dlp/`) | o yt-dlp decide |
| Pausa de proteção (`youtube-block.json`) | até a pausa acabar; a limpeza não mexe nele |

A limpeza roda no boot e de hora em hora. Apagar o diretório (`rm -rf services/severino-bot/cache/*`) é seguro a qualquer hora: tudo é refeito no próximo pedido. Os acertos aparecem em `severino_music_cache_hits_total`. Em 14/10/2026, tocar logo depois do pedido levou 0,95 s até o primeiro áudio (eram uns 4,7 s com a segunda extração).

### Pausa de proteção

Um "confirme que não é robô", um 403 ou um 429 do YouTube põe o YouTube em pausa por 1 hora (`severino_music_youtube_blocked` = 1, log `[música] falha (bot-check)`). O 403 conta porque o link de áudio vem de um JSON de no máximo 1 hora e só expira depois de horas: em 17/10/2026 ele veio junto com o "não é robô".

Durante a pausa, só toca o que já está no cache: pedidos novos são recusados com a hora da volta, e as faixas da fila que não estão no cache saem com um aviso. A pausa fica gravada no cache e continua depois de um reinício (o log diz `YouTube segue em pausa até …`). Para encerrá-la antes, apague `cache/youtube-block.json` e reinicie o bot.

## Quando a música dá problema

- **O YouTube mudou algo e as faixas falham** (alerta `SeverinoMusicaFalhando`, log `[música] falha (failure)`):
  1. Pegue a release nova do yt-dlp e o hash dela: `curl -sL https://github.com/yt-dlp/yt-dlp/releases/download/<versão>/SHA2-256SUMS | grep musllinux.zip`.
  2. Atualize `YTDLP_VERSION` e `YTDLP_SHA256` no `Dockerfile`.
  3. Rode `docker compose up -d --build`. O `update.sh` também reconstrói, mas com a versão fixada no `Dockerfile`, então só a troca do passo 2 atualiza o yt-dlp.
- **O YouTube barrou o bot** (alerta `SeverinoMusicaBloqueada`, log `[música] falha (bot-check)`): o bot já para de chamar o YouTube por 1 hora (pausa de proteção). Confira qual IP foi marcado, do host:
  ```bash
  UA='Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'
  curl -4 -s -o /dev/null -A "$UA" -w '%{http_code} %{redirect_url}\n' 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  curl -6 -s -o /dev/null -A "$UA" -w '%{http_code} %{redirect_url}\n' 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  ```
  `200` está limpo; `302` para `google.com/sorry` está marcado. O bot só usa o IPv6. Com o IPv6 limpo e o bloqueio voltando, o mais provável é o yt-dlp desatualizado (veja o item anterior). Com o IPv6 marcado, deixe a música parada por algumas horas. Testes em massa (umas 60 extrações em uma hora) já bastaram para marcar o IPv4. Se voltar sempre, há duas saídas, ainda não implementadas:
  - um provedor de PO token (`bgutil-ytdlp-pot-provider`);
  - cookies de uma conta Google descartável, nunca a pessoal.
- **O bot não entra no canal** (log `[música] Tentativa N de 2 de entrar em …`): o fim da linha diz onde a conexão parou. `signalling` é o Discord que não mandou o servidor de voz; `connecting/<etapa>` é o servidor de voz (`OpeningWs`, `Identifying`, `UdpHandshaking`, `SelectingProtocol`), onde também entra o DAVE; `disconnected/close <código>` traz o código de fechamento do Discord. Uma falha isolada que a segunda tentativa resolve não pede nada.
- **ffmpeg:** vem do Alpine, numa camada que fica em cache; rebuilds comuns, inclusive os do `update.sh`, não o atualizam. Para atualizar ffmpeg, Node e openssl de uma vez: `docker compose build --pull severino-bot && docker compose up -d`.

## Mudando o banco

1. Altere `prisma/schema.prisma`.
2. Gere a migração a partir das existentes, usando um Postgres descartável como banco-sombra:

   ```bash
   npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma \
     --shadow-database-url postgresql://... --script > prisma/migrations/2_descricao/migration.sql
   ```

3. Revise o SQL (dados que precisam ser convertidos entram no mesmo arquivo, dentro de `BEGIN; ... COMMIT;`), rode os testes e suba com `docker compose up -d --build`.

Nunca use `prisma db push` em produção: ele não guarda histórico e trava o boot quando a mudança apaga dados.
