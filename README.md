# Severino

Bot de Discord do servidor **SDJ**. Dá XP e moedas por atividade, mantém um ranking, cria salas de voz temporárias, toca música do YouTube e traz ferramentas de administração.

Feito em TypeScript com [Sapphire](https://www.sapphirejs.dev/) e discord.js, sobre PostgreSQL (Prisma). A música usa yt-dlp e ffmpeg.

## O que ele faz

- **XP e nível:** mensagens e tempo em call com mais gente rendem XP. Nível 2 aos 100 XP, 3 aos 400, 4 aos 900.
- **Moedas:** 100 por dia, pagas sozinhas na primeira atividade do dia.
- **Ranking:** geral e da semana; pode ficar fixo num canal, atualizado a cada 5 minutos.
- **Salas temporárias:** entrar num canal hub cria uma sala só sua, apagada quando esvazia.
- **Música:** toca do YouTube por link ou nome, com fila e um player com botões. Pede algum cargo além do @everyone.
- **Administração:** ajusta moedas e XP, limpa mensagens e registra cada ação.

O bot atende um servidor só, o do `GUILD_ID`, e sai de qualquer outro em que for adicionado. As regras em detalhe estão em [docs/regras.md](docs/regras.md).

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
| `/admin ranking canal` | Administradores | Publica o ranking num canal e o mantém atualizado. |
| `/admin sincronizar` | Administradores | Sincroniza os membros com o banco. |

## Instalação

### 1. Crie o bot no Discord

1. No [Developer Portal](https://discord.com/developers/applications), crie um aplicativo. Em **Bot**, clique em **Reset Token** e guarde o token: é o `DISCORD_TOKEN`.
2. Ainda em **Bot**, ligue **Server Members Intent**. Sem ele, o bot não conecta.
3. Em **OAuth2 → URL Generator**, marque `bot` e `applications.commands` e estas permissões: Ver canais, Enviar mensagens, Inserir links, Ver histórico de mensagens, Gerenciar mensagens, Gerenciar canais, Mover membros, Silenciar membros, Conectar e Falar. Abra o link gerado e adicione o bot ao servidor.
4. No Discord, ligue o modo desenvolvedor (Configurações → Avançado), clique com o botão direito no servidor e em **Copiar ID do servidor**: é o `GUILD_ID`.

### 2. Suba o bot

**No Docker, como roda em produção.** O `docker-compose.yml` fica no homelab, em `services/severino-bot/`, um nível acima deste repositório. Ele sobe o banco, aplica as migrações, sobe o bot e faz backup diário.

```bash
cd services/severino-bot
cp .env.example .env    # preencha as senhas, o DISCORD_TOKEN e o GUILD_ID
mkdir -p cache          # antes do primeiro up, senão o Docker cria a pasta como root
docker compose up -d --build
docker compose logs -f severino-bot   # espere por "Conectado como ..."
```

**Direto no Node, para desenvolver.** Precisa do Node 22 ou mais novo e de um PostgreSQL. A música também pede `yt-dlp` e `ffmpeg` no PATH.

```bash
git clone https://github.com/phplemos/severino-bot.git
cd severino-bot
npm ci

# Um Postgres descartável, se você não tiver um; já bate com o DATABASE_URL do .env.example
docker run -d --name severino-pg -p 127.0.0.1:5432:5432 \
  -e POSTGRES_USER=severino -e POSTGRES_PASSWORD=severino -e POSTGRES_DB=severino postgres:16-alpine

cp .env.example .env    # preencha o DISCORD_TOKEN e o GUILD_ID
npx prisma migrate deploy
npm run dev
```

Os comandos aparecem no servidor assim que o bot conecta. Teste com `/ping`.

### Variáveis

| Variável | Precisa? | Para quê |
| --- | --- | --- |
| `DISCORD_TOKEN` | Sim | Token do bot. |
| `GUILD_ID` | Sim | ID do servidor que o bot atende. |
| `DATABASE_URL` | Sim, no Node | URL do Postgres. No Docker, o compose a monta. |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Sim, no Docker | Dono do banco, usado pelas migrações e pelo backup. |
| `APP_DB_PASSWORD` | Sim, no Docker | Senha do papel `severino_app`, com que o bot só lê e grava dados. Só letras e números. |
| `HUB_CHANNEL_ID` | Não | Primeiro canal hub de salas; depois, use `/admin hub`. |
| `AUTO_SYNC_MEMBERS` | Não (`true`) | Sincroniza os membros no boot e de hora em hora. |
| `HEALTH_PORT` | Não (`8080`) | Porta do `/health` e do `/metrics`. |
| `YTDLP_PATH` | Não | Caminho do yt-dlp; vazio usa o do PATH. O Docker define o seu. |
| `YTDLP_FORCE_IPV6` | Não | `true` faz o yt-dlp sair só pelo IPv6. O Docker liga. |
| `MUSIC_CACHE_DIR` | Não | Pasta do cache da música; vazio desliga. O Docker usa `/cache`. |
| `CLIENT_ID` | Só para `npm run clear-cmds` | ID do aplicativo. O script apaga todos os comandos registrados, e o bot registra os atuais no próximo boot. |

## Desenvolvimento

```bash
npm run typecheck
npm test                                      # testes puros
TEST_DATABASE_URL=postgresql://... npm test   # inclui os de banco
```

Os testes de banco pedem um Postgres descartável com as migrações aplicadas. O CI no GitHub Actions roda tudo a cada push e também confere se as migrações batem com o schema e se há vulnerabilidades conhecidas. Para mudar o banco, veja [docs/operacao.md](docs/operacao.md#mudando-o-banco).

## Mais documentação

- [docs/regras.md](docs/regras.md): XP, voz, daily, ranking, música e salas em detalhe, e o player da música.
- [docs/operacao.md](docs/operacao.md): o compose do homelab, backup, cache e pausa da música, e o que fazer quando o YouTube barra o bot.
