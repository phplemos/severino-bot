# Reprodução de música — plano de implementação

**Objetivo:** o Severino toca áudio do YouTube nos canais de voz do SDJ, com fila e comandos `/musica`.

**Decisões (13/10/2026):**
- `@discordjs/voice` + `yt-dlp` + `ffmpeg` dentro do container do bot. Sem Lavalink e sem container novo.
- Fonte: só YouTube, por link de vídeo ou busca por texto.
- Servidor: só o SDJ, como o resto do bot.
- Acesso: `tocar`, `pular` e `parar` são para qualquer membro com pelo menos um cargo além do @everyone; administradores e donos do aplicativo sempre podem. `/musica fila` é livre.
- Faixas de até 30 minutos, que é o que o buffer guarda inteiro (ver "Como funciona").
- A fila fica em memória e se perde quando o bot reinicia. O banco não muda.

**Fora do MVP:** playlists, faixas acima de 30 minutos, volume, repetir e embaralhar, botões. Ver "Depois do MVP".

**Commits:** um por tarefa, no estilo do repositório (`feat:`, `docs:`), na branch `feat/musica`, desenvolvida num worktree separado (Tarefa 0).

## Como funciona

```
/musica tocar ─► parseQuery ─► yt-dlp -J (uma resolução por vez) ─► fila da sessão
                                                            │ chega a vez da faixa
                                                            ▼
     yt-dlp -o - ─► buffer de até 40 MiB ─► ffmpeg (Ogg/Opus, 48 kHz) ─► AudioPlayer ─► VoiceConnection (DAVE) ─► Discord
```

- Uma `MusicSession` por servidor (na prática, uma só) guarda a conexão de voz, o `AudioPlayer`, a fila, os processos da faixa atual, o canal de texto dos avisos e os timers de saída.
- Cada faixa é resolvida duas vezes: no pedido e na hora de tocar (o download). O pedido faz a extração completa, inclusive na busca (sem `--flat-playlist`), então já sabe o título, a duração e se o vídeo toca: restrição de idade, bloqueio regional e transmissão ao vivo são recusados no pedido, não quando chega a vez da faixa. O link do googlevideo expira, então ele nunca fica parado na fila.
- O ffmpeg entrega Opus em Ogg, e o `@discordjs/voice` só separa os pacotes: nenhuma lib nativa de Opus. A criptografia de transporte usa o aes-256-gcm do próprio Node, e o DAVE vem do `@snazzah/davey`, que o `@discordjs/voice` instala.
- O buffer entre o yt-dlp e o ffmpeg deixa o download terminar em segundos. Sem ele, o yt-dlp lê no ritmo da música, e uma conexão lenta e longa com o YouTube tende a cair no meio de faixas compridas. Um `PassThrough` guarda cerca do dobro do `highWaterMark` (lado de escrita mais lado de leitura): com 20 MiB, são uns 40 MiB, ou 35 minutos de Opus a 160 kb/s. Daí o limite de 30 minutos por faixa: o buffer sempre cabe a faixa inteira.
- Uma resolução por vez. Cada `-J` abre um yt-dlp e um Node para os desafios do YouTube, então pedidos simultâneos esperam a vez, até 5 na espera; além disso, o pedido é recusado. Com isso, o pior caso de memória é conhecido e medido na Tarefa 1: o bot, uma faixa tocando e uma resolução.

## Fatos verificados em 13/10/2026

| Fato | Como | Consequência |
|---|---|---|
| O `/tmp` do container é tmpfs com `nosuid,nodev,noexec` | `/proc/mounts` no `severino-bot` | O binário único `yt-dlp_musllinux` não serve: ele se extrai no `/tmp` e carrega `.so` de lá. Usar o `yt-dlp_musllinux.zip` (pasta) dentro da imagem. |
| O `yt-dlp_musllinux.zip` 2026.08.19 (a release mais recente) traz `_internal/yt_dlp_ejs/` | `unzip -l`; o SHA-256 confere com o `SHA2-256SUMS` da release | Os scripts que resolvem os desafios do YouTube vêm junto. São 94 MB descompactados. |
| O yt-dlp aceita Node 22+ como runtime JS (`--js-runtimes node`) | wiki EJS do yt-dlp | O Node 24 do container serve; não precisa de Deno. |
| O ffmpeg do Alpine 3.24 (8.1.2) tem o encoder `libopus` | `ffmpeg -encoders` em `node:24-alpine` | `apk add ffmpeg` basta. |
| O Node do container tem `aes-256-gcm` | `crypto.getCiphers()` | Sem `sodium-native` nem `libsodium-wrappers`. |
| `@discordjs/voice` 0.19.2 (17/03/2026, a `latest`) depende do `@snazzah/davey`, que publica binário `linux-x64-musl` | npm | O DAVE roda no Alpine sem compilar nada. |
| O bot em repouso usa 84 MiB de 256 MiB e 18 de 100 PIDs; o host tem 4 CPUs | `docker stats` | Os limites precisam subir; a Tarefa 1 mede quanto. |
| O container lê o próprio pico em `/sys/fs/cgroup/memory.peak` e `pids.peak` | `docker exec severino-bot cat …` | Medição exata do pico, sem depender da amostragem do `docker stats`. O valor de memória inclui cache de arquivos, então é um teto. |
| O `scripts/update.sh` roda `docker compose pull` e depois `up -d`; com o `pull_policy: build` do bot, o `up -d` reconstrói a imagem a partir de `services/severino-bot/severino-bot`, usando cache | leitura do script e do compose | Código em andamento nessa pasta vai para produção no próximo `update.sh`; por isso o desenvolvimento é num worktree (Tarefa 0). A versão do yt-dlp é fixa e as camadas ficam em cache, então atualizar yt-dlp e ffmpeg é manual (ver "Manutenção"). |

## Segurança

- **Só URLs do YouTube chegam ao yt-dlp.** O yt-dlp tem um extrator genérico que baixa qualquer URL, e o bot está nas redes `severino_net` (banco) e `monitoring` (Prometheus, Grafana). Link fora da lista de hosts é recusado e texto livre vira `ytsearch1:<texto>`. O link do vídeo é remontado a partir do ID validado (`https://www.youtube.com/watch?v=<id>`), nunca repassado como veio.
- Os processos são criados com `spawn` e lista de argumentos, sem shell. O alvo vem depois de `--`, para que um texto começando com `-` não vire opção, e `--ignore-config` impede que um arquivo de configuração mude o comportamento.
- Sem cookies e sem conta Google. Se o YouTube passar a exigir login (ver "Manutenção"), a resposta é uma conta descartável, nunca a pessoal.
- Há prazo para resolver (30 s, contados do início do processo) e os processos morrem ao pular, parar, sair do canal ou desligar o bot. Uma resolução por vez e no máximo 5 na espera: pedidos em massa não multiplicam processos.
- Respostas e avisos não mencionam ninguém (`allowedMentions: { parse: [] }`) e passam por `escapeMarkdown`, porque repetem texto digitado e títulos de vídeo, que podem trazer `@everyone` ou `<@&cargo>`.

---

### Tarefa 0: Worktree, branch e linha de base

O compose constrói a imagem a partir de `services/severino-bot/severino-bot`, e o `update.sh` reconstrói ao rodar `up -d`. Por isso o trabalho fica num worktree ao lado, e aquela pasta continua na `main` até a Tarefa 9.

Comandos a partir de `services/severino-bot`:

- [x] `git -C severino-bot worktree add ../severino-bot-musica -b feat/musica`
- [x] Mover este plano para `severino-bot-musica/docs/superpowers/plans/` e fazer o primeiro commit (`docs: plano da reprodução de música`). Daqui em diante, o plano vive no worktree.
- [x] Em `severino-bot-musica`: `npm ci && npm run typecheck && npm test`: tudo verde antes de mexer.

---

### Tarefa 1: Imagem com ffmpeg e yt-dlp, e medição (portão)

Esta tarefa decide se o caminho se sustenta no container endurecido. Nada muda em produção: o código fica no worktree e a imagem de teste usa outra tag.

**Arquivos:** modificar `Dockerfile`.

- [x] **Passo 1:** novo estágio antes do final:

```dockerfile
# yt-dlp em pasta, não o binário único: o binário único se extrai no /tmp, que é noexec no container
FROM alpine:3.24 AS ytdlp
ARG YTDLP_VERSION=2026.08.19
ARG YTDLP_SHA256=a8a9761628be455368db73ab54a2858da22342084f300f7e0d50bdcbef2acf82
RUN wget -q -O /tmp/yt-dlp.zip "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_musllinux.zip" \
	&& echo "${YTDLP_SHA256}  /tmp/yt-dlp.zip" | sha256sum -c - \
	&& mkdir -p /opt/yt-dlp && unzip -q /tmp/yt-dlp.zip -d /opt/yt-dlp \
	&& chmod 755 /opt/yt-dlp/yt-dlp_musllinux
```

E no estágio final:

```dockerfile
# ffmpeg converte o áudio do YouTube em Opus para o Discord
RUN apk add --no-cache openssl ffmpeg
ENV NODE_ENV=production CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 YTDLP_PATH=/opt/yt-dlp/yt-dlp_musllinux
COPY --from=ytdlp /opt/yt-dlp /opt/yt-dlp
```

- [x] **Passo 2:** build com tag separada. A `severino-bot:latest` fica intacta, porque o `severino-migrate` também a usa.

```bash
docker build -t severino-bot:musica-teste severino-bot-musica
```

- [x] **Passo 3:** rodar com as mesmas restrições do compose.

```bash
docker run --rm -it --read-only --tmpfs /tmp:rw,noexec,nosuid,nodev --cap-drop ALL \
  --security-opt no-new-privileges:true --memory 512m --pids-limit 200 \
  --name musica-teste --entrypoint sh severino-bot:musica-teste

# dentro do container: um vídeo qualquer e um de 25 a 30 minutos, perto do limite por faixa
VIDEO='https://www.youtube.com/watch?v=<id>'
LONGO='https://www.youtube.com/watch?v=<id>'
Y="$YTDLP_PATH --ignore-config --js-runtimes node --cache-dir /tmp/yt-dlp"
F='bestaudio[acodec=opus]/bestaudio/best'
ENC='-hide_banner -loglevel error -i pipe:0 -vn -ac 2 -ar 48000 -c:a libopus -b:a 128k -f ogg'

$Y --version
$Y -v --simulate -f "$F" -- "$VIDEO" 2>&1 | grep -i -E 'js runtime|ejs|challenge|error'

# 3a. Tempo de resolução, com extração completa nos dois casos, como no bot
time $Y -J --no-playlist -f "$F" -- 'ytsearch1:pink floyd time' | head -c 300
time $Y -J --no-playlist -f "$F" -- "$VIDEO" | head -c 300

# 3b. Pior caso: uma faixa baixando e uma resolução ao mesmo tempo.
# A saída vai para /dev/null porque arquivo no tmpfs conta na memória do container.
$Y -q -f "$F" -o - -- "$LONGO" | ffmpeg $ENC pipe:1 > /dev/null &
$Y -J --no-playlist -f "$F" -- "$VIDEO" > /dev/null
wait
cat /sys/fs/cgroup/memory.peak /sys/fs/cgroup/pids.peak

# 3c. A faixa longa chega inteira (depois do 3b, para o arquivo não entrar no pico)
time ($Y -q -f "$F" -o - -- "$LONGO" | ffmpeg $ENC /tmp/saida.ogg)
ffprobe -hide_banner /tmp/saida.ogg
rm /tmp/saida.ogg
```

- [x] **Passo 4:** critérios do portão. Anote os números em "Medições", no fim deste plano.
  - `--version` roda, sem erro de `.so` ou de permissão.
  - O `-v` mostra o Node como runtime JS e nenhum aviso de desafio não resolvido.
  - O `ffprobe` mostra a duração inteira do vídeo longo.
  - Os dois `-J` levam poucos segundos. Somados ao início do download, dão o tempo até o primeiro som.
  - O teste não tem o bot nem o buffer. O limite do compose é a soma do pico do 3b, do bot em repouso (84 MiB e 18 PIDs) e do buffer cheio (40 MiB), com uns 25% de folga. Essa soma precisa caber em 512 MiB e 200 PIDs. Se não couber, reavalie antes de seguir.
- [x] **Se o `.zip` falhar:** (testado no critério de memória, que falhou também no zipimport; não adotado, ver "Desvios") trocar pelo `yt-dlp` zipimport da mesma release (3 MB, também traz os scripts EJS), com `apk add python3` no estágio final e `YTDLP_PATH=/opt/yt-dlp/yt-dlp`. O arquivo tem shebang de `python3`, então o código não muda. Se os dois falharem, pare e reavalie (Lavalink).
- [x] **Passo 5:** `docker rmi severino-bot:musica-teste` e commit do `Dockerfile`.

---

### Tarefa 2: Dependência e configuração

**Arquivos:** `package.json`, `package-lock.json`, `src/config.ts`, `.env.example`.

- [x] `npm install --save-exact @discordjs/voice@0.19.2`. O `package.json` fixa versões exatas.
- [x] Conferir que o lock registra o binário musl, que é o que o `npm ci` do Alpine instala: `grep -c 'davey-linux-x64-musl' package-lock.json` deve dar 1 ou mais.
- [x] `npm ls discord-api-types`: uma versão só. Duas versões costumam quebrar o tipo do `guild.voiceAdapterCreator`; se acontecer, `npm dedupe`.
- [x] Em `config.ts`, adicionar `YTDLP_PATH: z.preprocess(emptyToUndefined, z.string().default('yt-dlp'))`. Fora do Docker valem o `yt-dlp` e o `ffmpeg` do PATH; na imagem, o `ENV` da Tarefa 1.
- [x] No `.env.example` do bot, que é o de desenvolvimento: `YTDLP_PATH=""`, com o comentário de que vazio usa o `yt-dlp` do PATH e de que o Docker define o seu.
- [x] Reconstruir a imagem de teste e conferir o relatório da lib:

```bash
docker build -t severino-bot:musica-teste severino-bot-musica
docker run --rm --entrypoint node severino-bot:musica-teste -e "console.log(require('@discordjs/voice').generateDependencyReport())"
```

Esperado: DAVE com `@snazzah/davey`, criptografia `aes-256-gcm` nativa e FFmpeg encontrado. A ausência de lib de Opus é esperada.

- [x] `npm run typecheck && npm test && npm audit --audit-level=high`

---

### Tarefa 3: Funções puras e testes

Tudo o que dá para testar sem Discord nem processos. **Nenhum destes arquivos importa `config.ts`:** ele valida o ambiente na importação, e os testes não têm `DISCORD_TOKEN`.

**Arquivos:** criar `src/lib/music/query.ts`, `src/lib/music/queue.ts`, `src/lib/music/limiter.ts` e `src/lib/music/ytdlp.ts`; modificar `src/lib/format.ts` e `src/lib/permissions.ts`; criar `test/music.test.ts`.

- [x] **`query.ts`**

```ts
export type ParsedQuery =
	| { kind: 'video'; id: string; url: string } // url sempre https://www.youtube.com/watch?v=<id>
	| { kind: 'search'; text: string }
	| { kind: 'playlist' }
	| { kind: 'invalid' };

export function parseQuery(input: string): ParsedQuery;
```

Regras:
- Texto vazio depois do `trim` é `invalid`.
- Texto sem espaços que começa com `http://`, `https://` ou com um host do YouTube é tratado como link; o resto é busca.
- Hosts aceitos, comparados em minúsculas e por igualdade: `youtube.com`, `www.youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtu.be`. Qualquer outro host é `invalid`.
- O ID vem do `v=` em `/watch`, do caminho em `youtu.be/<id>` e de `/shorts/<id>`, `/live/<id>` e `/embed/<id>`, e precisa casar com `/^[A-Za-z0-9_-]{11}$/`.
- `/playlist?list=…` sem vídeo é `playlist`. Um `/watch` com `list=` é `video`, e a lista é ignorada.

Casos de teste:

| Entrada | Resultado |
|---|---|
| `https://www.youtube.com/watch?v=dQw4w9WgXcQ` | `video`, ID `dQw4w9WgXcQ` |
| `https://youtu.be/dQw4w9WgXcQ?si=abc` | `video` |
| `youtube.com/watch?v=dQw4w9WgXcQ` (sem esquema) | `video` |
| `https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDxyz` | `video` |
| `https://m.youtube.com/watch?v=…`, `/shorts/<id>`, `/live/<id>` | `video` |
| `https://www.youtube.com/playlist?list=PLxyz` | `playlist` |
| `https://www.youtube.com/watch?v=curto` (ID inválido) | `invalid` |
| `https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ` | `invalid` |
| `http://prometheus:9090/`, `http://127.0.0.1:8080/metrics`, `https://vimeo.com/1` | `invalid` |
| `pink floyd time` | `search` |
| `--exec rm -rf` | `search`, com o texto intacto |
| `   ` | `invalid` |

- [x] **`queue.ts`**

```ts
export interface Track {
	id: string;
	title: string;
	url: string;
	durationSeconds: number | null;
	channel: string | null;
	requestedBy: string;
}

export const MAX_QUEUE = 50;

export class TrackQueue {
	/** Posição na fila (1 = a próxima), ou null se a fila está cheia. */
	push(track: Track): number | null;
	shift(): Track | undefined;
	clear(): void;
	get size(): number;
	list(limit?: number): Track[];
	/** Soma das durações conhecidas. */
	totalSeconds(): number;
}
```

Testes: ordem de chegada, limite de 50, `clear`, `totalSeconds` ignorando durações nulas.

- [x] **`limiter.ts`:** limita as resoluções simultâneas.

```ts
export class Limiter {
	constructor(concurrency: number, maxWaiting: number);
	/** Roda a tarefa quando houver vaga; devolve null, sem rodar, se a espera já está cheia. */
	run<T>(task: () => Promise<T>): Promise<T | null>;
}
```

Testes: com `new Limiter(1, 5)`, as tarefas rodam uma de cada vez e na ordem; a sétima simultânea recebe `null`; uma tarefa que lança libera a vaga.

- [x] **`ytdlp.ts`:** argumentos, leitura do JSON e classificação de erro.

```ts
export const RESOLVE_TIMEOUT_MS = 30_000;
// O buffer da Tarefa 4 guarda uns 35 minutos; a faixa inteira precisa caber nele
export const MAX_TRACK_SECONDS = 30 * 60;

const AUDIO_FORMAT = 'bestaudio[acodec=opus]/bestaudio/best';
const COMMON = [
	'--ignore-config', '--quiet', '--no-warnings', '--no-progress', '--no-playlist',
	'--js-runtimes', 'node', '--cache-dir', '/tmp/yt-dlp', '--socket-timeout', '15'
];

/** target é a URL remontada pelo parseQuery ou `ytsearch1:<texto>`. Sem --flat-playlist: a busca também passa pela escolha de formato. */
export const resolveArgs = (target: string) => [...COMMON, '-J', '-f', AUDIO_FORMAT, '--', target];
export const streamArgs = (url: string) => [...COMMON, '-f', AUDIO_FORMAT, '-o', '-', '--', url];
export const FFMPEG_ARGS = [
	'-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn',
	'-ac', '2', '-ar', '48000', '-c:a', 'libopus', '-b:a', '128k', '-f', 'ogg', 'pipe:1'
];

export type ResolveResult =
	| { ok: true; track: Omit<Track, 'requestedBy'> }
	| { ok: false; reason: 'no-results' | 'live' | 'too-long' };
export function parseResolved(json: unknown): ResolveResult;

export type YtDlpFailure = 'unavailable' | 'age' | 'bot-check' | 'failure';
export function classifyFailure(stderr: string): YtDlpFailure;
/** Texto para a pessoa, o mesmo no pedido e na hora de tocar. */
export function failureMessage(reason: YtDlpFailure): string;
```

`parseResolved`:
- Busca (`_type: 'playlist'`): usa `entries[0]`; sem entradas, `no-results`.
- Lê `id`, `title`, `duration` (número ou nulo) e `channel ?? uploader ?? null`.
- `live_status` igual a `is_live` ou `is_upcoming`, ou `is_live: true`, dá `live`.
- Duração acima de `MAX_TRACK_SECONDS` dá `too-long`.
- A `url` é remontada a partir do ID, depois de validar o ID com a mesma regex do `parseQuery`.

`classifyFailure`:

| Trecho no stderr (sem diferenciar maiúsculas) | Tipo |
|---|---|
| `Sign in to confirm you.re not a bot` | `bot-check` |
| `confirm your age`, `age-restricted`, `inappropriate for some users` | `age` |
| `Private video`, `Video unavailable`, `has been removed`, `not available in your country`, `members-only` | `unavailable` |
| qualquer outro (inclusive `Requested format is not available`) | `failure` |

`failureMessage` usa os textos da tabela da Tarefa 6.

Testes: um JSON de busca, um de vídeo, busca vazia, ao vivo, longo demais, ID inválido, e uma linha de stderr de cada tipo.

- [x] **`format.ts`:** `formatTrackTime(seconds: number | null)`. 225 vira `3:45`, 3723 vira `1:02:03` e `null` vira `?`.
- [x] **`permissions.ts`:**
  - `hasAnyRole(roleIds: Iterable<string>, guildId: string): boolean`. O cargo @everyone tem o mesmo ID do servidor e não conta.
  - `canUseMusic(interaction: ChatInputCommandInteraction<'cached'>): Promise<boolean>`, que libera quem passa no `isBotAdmin` ou no `hasAnyRole`.
  - Testes do `hasAnyRole`: só @everyone, @everyone mais um cargo, nenhum cargo.
- [x] `npm run typecheck && npm test`

---

### Tarefa 4: Processos de áudio

**Arquivos:** criar `src/lib/music/process.ts`. Este é o único arquivo de música que importa `config.ts`.

```ts
export type ResolveOutcome = ResolveResult | { ok: false; reason: YtDlpFailure | 'busy' };
export function resolveTrack(target: string): Promise<ResolveOutcome>;

/** A regra única de contagem: bot-check e failure contam; unavailable e age são do vídeo, não nossos. */
export function recordFailure(reason: YtDlpFailure): void;

export interface AudioHandle {
	stream: Readable;
	/** null quando os dois processos terminaram bem ou foram mortos por nós; senão, o tipo da falha. */
	finished: Promise<YtDlpFailure | null>;
	kill(): void;
}
export function openAudio(url: string): AudioHandle;
```

- [x] **`resolveTrack`:**
  - Passa por um `Limiter(1, 5)`. Espera cheia: devolve `busy` sem abrir processo.
  - Roda `config.YTDLP_PATH` com `resolveArgs`, mata o processo depois de `RESOLVE_TIMEOUT_MS` (contados do início do processo, não da espera) e aceita até 10 MB de stdout.
  - Saída 0: `parseResolved(JSON.parse(stdout))`.
  - Qualquer outra saída: `classifyFailure(stderr)`.
  - Erro de `spawn`, por exemplo `ENOENT` quando falta o yt-dlp: `failure`.
- [x] **`recordFailure`:** `bot-check` soma em `musicBotChecks`, `failure` soma em `musicFailures`, e `unavailable` e `age` não somam em nada. O comando e a sessão usam só esta função para contar.
- [x] **`openAudio`:** o núcleo é este:

```ts
const download = spawn(config.YTDLP_PATH, streamArgs(url), { stdio: ['ignore', 'pipe', 'pipe'] });
const encoder = spawn('ffmpeg', FFMPEG_ARGS, { stdio: ['pipe', 'pipe', 'pipe'] });
// Guarda uns 40 MiB (escrita + leitura), a faixa inteira dentro do limite de 30 min: o yt-dlp baixa em segundos
const buffer = new PassThrough({ highWaterMark: 20 * 1024 * 1024 });
download.stdout.pipe(buffer).pipe(encoder.stdin);
// EPIPE quando o ffmpeg morre primeiro; o resultado sai de `finished`
encoder.stdin.on('error', () => undefined);
```

- [x] Guardar os últimos 4 KB do stderr de cada processo, para classificar a falha e para o log.
- [x] **`finished`:** resolve quando os dois processos fecharam.
  - Devolve `classifyFailure(stderr)` se o yt-dlp saiu com erro.
  - Devolve `failure` se só o ffmpeg saiu com erro, ou se o `spawn` de qualquer um dos dois falhou.
  - Devolve `null` se os dois saíram com 0 ou foram mortos por nós.
  - Registrar no log `[música] falha (<tipo>) em <id>: <última linha do stderr do processo que falhou>`.
- [x] **`kill()`:** idempotente. Marca como "morto por nós" só o processo que ainda está vivo (`exitCode === null && signalCode === null`). Um processo que já saiu sozinho guarda o próprio resultado, para que uma falha que chegou antes do `Idle` não seja apagada. SIGTERM nos vivos e, se em 2 s ainda estiverem vivos, SIGKILL. O `init: true` do compose recolhe os processos zumbis.

---

### Tarefa 5: Sessão de música

**Arquivos:** criar `src/lib/music/session.ts`.

```ts
export const IDLE_LEAVE_MS = 5 * 60_000;
export const ALONE_LEAVE_MS = 2 * 60_000;

export function getSession(guildId: string): MusicSession | undefined;
/** Roda a tarefa sozinha no servidor: uma cadeia de promessas por guildId, que segue mesmo se uma tarefa lançar. */
export function withSessionLock<T>(guildId: string, task: () => Promise<T>): Promise<T>;
/** Entra no canal; rejeita se a conexão não ficar pronta em 20 s. Só chamar dentro de withSessionLock. */
export function startSession(channel: VoiceChannel, textChannel: GuildTextBasedChannel): Promise<MusicSession>;
export function destroyAllSessions(): void;
/** Chamado pelo listener de voz; nunca lança. */
export function onVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): void;

export class MusicSession {
	readonly guildId: string;
	get voiceChannelId(): string;
	get current(): Track | null;
	readonly queue: TrackQueue;
	/** 0 = começou a tocar agora; n = posição na fila; null = fila cheia. */
	enqueue(track: Track): number | null;
	skip(): Track | null;
	destroy(reason: string): void;
}
```

- [x] **Entrada no canal (`startSession`):**
  - `joinVoiceChannel({ channelId, guildId, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true })` e depois `await entersState(connection, VoiceConnectionStatus.Ready, 20_000)`. Se falhar, `connection.destroy()` e propagar o erro. É aqui que aparecem problemas de DAVE e de permissão.
  - `createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } })` e `connection.subscribe(player)`.
  - Registrar a sessão no mapa e pôr `metrics.musicConnected = 1`.
- [x] Reconexão, no padrão do guia do discord.js:

```ts
connection.on(VoiceConnectionStatus.Disconnected, async () => {
	try {
		// Movido de canal ou reconectando: a própria lib se recupera
		await Promise.race([
			entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
			entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
		]);
	} catch {
		this.destroy('desconectado do canal de voz');
	}
});
connection.on(VoiceConnectionStatus.Destroyed, () => this.destroy('conexão encerrada'));
```

- [x] **`playNext({ announce })`:**
  - Tira a próxima faixa da fila. Sem faixa, `current = null` e o timer de ociosidade começa.
  - Com faixa: `current = track` na hora, depois `openAudio(track.url)`, `createAudioResource(handle.stream, { inputType: StreamType.OggOpus, metadata: track })`, `player.play(resource)` e `metrics.musicTracksStarted++`.
  - `announce` vale `false` quando o próprio `/musica tocar` responde que a faixa começou, para não avisar duas vezes.
- [x] **`AudioPlayerStatus.Idle`:**
  - Chamar `handle.kill()` e depois `await handle.finished`.
  - Se houve falha: `recordFailure(tipo)` e avisar "⚠️ Não consegui tocar **título**: <failureMessage(tipo)>". Como o pedido já resolve a faixa por inteiro, aqui sobram as falhas do download.
  - Seguir com `playNext({ announce: true })`.
- [x] No `error` do player, registrar no log. O `Idle` vem em seguida e cuida do resto.
- [x] **Timers:**
  - Com a fila vazia, a sessão sai depois de `IDLE_LEAVE_MS` com "👋 Saí do canal: nada tocou nos últimos 5 minutos". Um `enqueue` cancela o timer.
  - `onVoiceStateUpdate`:
    - O canal do bot ficou sem humanos: sai depois de `ALONE_LEAVE_MS` com "👋 Saí do canal: fiquei sozinho". Se alguém voltar, o timer é cancelado.
    - O próprio bot (`newState.id === client.user.id`) mudou de canal: atualiza `voiceChannelId` e reavalia o timer de "sozinho" no canal novo.
    - O bot foi tirado do canal (`newState.channelId === null`): `destroy`.
- [x] **Avisos:** `textChannel.send({ content, allowedMentions: { parse: [] } })` com `.catch` que só registra no log. Títulos passam por `escapeMarkdown`.
- [x] **`destroy(reason)`:**
  - É idempotente: limpa os timers e a fila, chama `handle?.kill()` e `player.stop(true)`, destrói a conexão se ela ainda existir, tira a sessão do mapa e põe `metrics.musicConnected = 0`.
  - Registra no log `[música] sessão encerrada: <motivo>`.
- [x] Salas temporárias: `tempRooms.ts` não muda. Bots não seguram sala, então quando o último humano sai a sala é apagada com o bot dentro, o bot cai e a sessão termina pelo `Disconnected`. O teste fica na checklist da Tarefa 9.

---

### Tarefa 6: Comando `/musica`

**Arquivos:** criar `src/commands/musica.ts`. Segue o padrão do `admin.ts`: um `switch` por subcomando.

```
/musica tocar busca:<texto, obrigatório, até 200>   Nome da música ou link do YouTube
/musica pular
/musica parar
/musica fila
```

- [x] Opções do comando: `preconditions: ['GuildOnly']` e `cooldownDelay: 2_000`. O listener de negação já responde ao cooldown. Não usar `setDefaultMemberPermissions`: todo mundo vê o comando e a checagem de cargo responde quem não pode.
- [x] **Regras para todas as respostas:**
  - `allowedMentions: { parse: [] }`, e texto digitado e títulos passam por `escapeMarkdown`.
  - Recusas antes do `deferReply` são efêmeras, como no `/admin`.
- [x] **Acesso:** `tocar`, `pular` e `parar` começam por `interaction.inCachedGuild()` e `canUseMusic`. Quem não passa recebe "⛔ A música é para quem tem algum cargo no servidor." O `fila` é livre.
- [x] **`tocar`**, depois do acesso, nesta ordem:
  1. Canal de voz de quem pediu:
     - nenhum: "Entre num canal de voz primeiro.";
     - palco: "Não toco em canal de palco.";
     - canal AFK do servidor: "Não toco no canal AFK.".
  2. Checagem rápida, para não gastar uma resolução à toa: se há sessão em outro canal com `current`, a resposta é "🎶 Já estou tocando em <#id>. Entre lá para pedir música.". A decisão final fica para o passo 7.
  3. Permissões do bot no canal:
     - sem `ViewChannel`, `Connect` e `Speak` em `channel.permissionsFor(me)`: "⚠️ Preciso das permissões Conectar e Falar em <#id>.";
     - `!channel.joinable`: "⚠️ <#id> está cheio.".
  4. `parseQuery`:
     - `invalid`: "Só aceito link do YouTube ou o nome da música.";
     - `playlist`: "Playlists ainda não; mande o link de um vídeo.".
  5. `await interaction.deferReply()`. A resolução leva alguns segundos e o Discord só espera 3.
  6. `resolveTrack`, com a URL do vídeo ou `ytsearch1:<texto>`. Nas falhas do yt-dlp, a resposta é `failureMessage` e a contagem é `recordFailure`:

     | Resultado | Resposta | Métrica |
     |---|---|---|
     | `busy` | Muita gente pedindo ao mesmo tempo. Tente de novo em alguns segundos. | — |
     | `no-results` | Não achei nada para **texto**. | — |
     | `live` | Transmissões ao vivo ainda não são suportadas. | — |
     | `too-long` | Esse vídeo passa de 30 minutos. | — |
     | `unavailable` | Esse vídeo está indisponível (privado, removido ou bloqueado no Brasil). | — |
     | `age` | Esse vídeo tem restrição de idade e não consigo tocá-lo. | — |
     | `bot-check` | O YouTube bloqueou o bot por enquanto. Tente mais tarde. | `musicBotChecks++` |
     | `failure` | Não consegui buscar esse vídeo. O erro ficou registrado. | `musicFailures++` |

  7. Dentro de `withSessionLock(guildId, …)`, para que dois pedidos simultâneos não criem duas sessões nem um derrube a do outro. A checagem do passo 2 se repete aqui, porque a resolução levou segundos:
     - sessão no mesmo canal: usa ela;
     - sessão em outro canal com `current`: "🎶 Já estou tocando em <#id>. Entre lá para pedir música.";
     - sessão em outro canal sem `current`: `destroy('mudou de canal')` e entra no novo;
     - sem sessão: `startSession(channel, interaction.channel)`. Se falhar, registrar no log e responder "⚠️ Não consegui entrar em <#id>.".
  8. `enqueue`, ainda dentro da trava:
      - `null`: "A fila está cheia (50 músicas).";
      - `0`: "▶️ Tocando agora: **título** · 3:45";
      - `n`: "➕ Na fila (posição n): **título** · 3:45".
- [x] **`pular` e `parar`:** depois do acesso, precisam de sessão e de quem pediu estar no mesmo canal do bot. Fora do canal, a resposta é "Entre em <#id> para controlar a música.".
  - `pular`: "⏭️ Pulei **título**." ou "Não há nada tocando.".
  - `parar`: `destroy('parado por <usuário>')` e "⏹️ Parei e saí do canal.".
- [x] **`fila`:** resposta efêmera com a faixa atual, as próximas 10 com posição, duração e quem pediu, e o total. Usar um embed no estilo do `/perfil`. Sem sessão ou sem faixa atual: "Nada tocando.".
- [x] Erros dentro dos subcomandos podem lançar: o `chatInputCommandError` já responde e conta em `commandErrors`.

---

### Tarefa 7: Integração, métricas, compose e alertas

**Arquivos:**
- No bot: `src/listeners/voiceStateUpdate.ts`, `src/index.ts`, `src/lib/metrics.ts`.
- No homelab: `services/severino-bot/docker-compose.yml` e `services/monitoring/prometheus/rules/severino.yml`.

- [ ] **`voiceStateUpdate.ts`:** chamar `onVoiceStateUpdate(oldState, newState)` logo depois da primeira guarda (servidor e mudança de canal), antes de duas coisas:
  - do `return` para bots, para enxergar o próprio bot sendo movido ou expulso;
  - dos acessos ao banco, para que uma falha do banco não deixe o bot preso no canal.
- [ ] **`index.ts`:** chamar `destroyAllSessions()` no `shutdown`, antes do `client.destroy()`.
- [ ] **`metrics.ts`:**

| Campo | Métrica | Tipo | Ajuda |
|---|---|---|---|
| `musicConnected` | `severino_music_connected` | gauge | 1 quando o bot está num canal de voz para tocar música. |
| `musicTracksStarted` | `severino_music_tracks_started_total` | counter | Faixas que começaram a tocar. |
| `musicFailures` | `severino_music_failures_total` | counter | Faixas que falharam por erro do yt-dlp ou do ffmpeg; vídeo indisponível ou com restrição de idade não conta. |
| `musicBotChecks` | `severino_music_bot_checks_total` | counter | Vezes em que o YouTube pediu para confirmar que não é robô. |

- [ ] **Compose (serviço `severino-bot`):** pôr os limites calculados na Tarefa 1 (pico do 3b + bot em repouso + buffer, com folga). A expectativa é esta, com o comentário trazendo a conta:

```yaml
    # Node + yt-dlp + ffmpeg tocando música; em <data>: pico <X> MiB e <Y> PIDs (faixa + resolução) + bot + buffer, com folga
    mem_limit: 512m
    pids_limit: 200
    tmpfs:
      # Cache do yt-dlp; o tmpfs conta na memória do container
      - /tmp:size=64m
```

  Validar com `docker compose config -q`. A mudança vale no próximo `up -d` do stack, mesmo antes da Tarefa 9; limites maiores não atrapalham a versão atual.
- [ ] **Alertas,** acrescentados a `severino.yml`. Os dois apontam para o README do bot, que recebe o conteúdo da seção "Manutenção" (Tarefa 8):

```yaml
      - alert: SeverinoMusicaFalhando
        expr: increase(severino_music_failures_total[30m]) >= 3
        labels:
          severity: warning
        annotations:
          summary: "A música do Severino está falhando"
          description: "Três ou mais faixas falharam em 30 minutos por erro do yt-dlp ou do ffmpeg (vídeo indisponível ou com restrição de idade não conta). Quase sempre é o YouTube mudando algo: veja docker logs severino-bot e atualize o yt-dlp (README do bot, seção Música)."

      - alert: SeverinoMusicaBloqueada
        expr: increase(severino_music_bot_checks_total[1h]) > 0
        labels:
          severity: warning
        annotations:
          summary: "O YouTube está barrando o Severino"
          description: "O YouTube pediu para confirmar que não é robô: o IP de casa foi marcado. Deixe a música parada por algumas horas; se voltar sempre, veja o README do bot, seção Música."
```

  Validar com `promtool check rules`, usando a mesma imagem do Prometheus do stack `monitoring`. Recarregar com `curl -X POST http://127.0.0.1:20302/-/reload` (o Prometheus roda com `--web.enable-lifecycle`).

---

### Tarefa 8: Documentação

- [ ] **README do bot:**
  - uma linha "Música" na tabela de regras: quem pode, faixas de até 30 minutos, até 50 na fila, saída automática;
  - os quatro subcomandos na tabela de comandos (`tocar`, `pular` e `parar` para quem tem cargo; `fila` para todos);
  - a seção "Música" em "Como roda no homelab", com o conteúdo de "Manutenção" deste plano: atualizar o yt-dlp e o ffmpeg e o que fazer quando o YouTube pede para confirmar que não é robô. É para lá que os dois alertas apontam;
  - em "Desenvolvimento": a música fora do Docker precisa de `yt-dlp` e `ffmpeg` no PATH, ou do `YTDLP_PATH` do `.env.example`. A tabela de variáveis não muda, porque ela é a do `.env` de produção.
- [ ] **`CHANGELOG.md` do homelab:** uma entrada em `[Unreleased]` → `Added` com o `/musica`, os novos limites do container e os dois alertas.
- [ ] **`SECURITY.md` do homelab:** registrar que o bot executa yt-dlp e ffmpeg, que só URLs do YouTube chegam ao yt-dlp e que as resoluções rodam uma por vez.

---

### Tarefa 9: Deploy e validação no SDJ

- [ ] No Discord, conferir que o cargo do Severino tem Conectar e Falar no servidor e nas categorias das salas temporárias.
- [ ] Trocar o worktree pela branch na pasta do build e subir. As migrações não mudam.

```bash
cd services/severino-bot
git -C severino-bot-musica status --short          # vazio: tudo commitado
git -C severino-bot worktree remove ../severino-bot-musica
git -C severino-bot switch feat/musica
docker compose up -d --build
docker compose logs -f severino-bot
docker inspect severino-bot --format '{{.State.Health.Status}}'
```

- [ ] Checklist, num horário calmo:
  1. `/musica tocar` com texto toca. Anote o tempo até o primeiro som.
  2. Um link `youtu.be/…` toca, e um link com `&list=` toca só o vídeo.
  3. São recusados já no pedido: link de playlist pura, link de outro site, `http://prometheus:9090`, um vídeo de mais de 30 minutos e um vídeo com restrição de idade.
  4. Com três pedidos, `/musica fila` mostra a ordem certa, e cada troca de faixa aparece no canal de texto.
  5. Duas pessoas pedem ao mesmo tempo com o bot fora do canal: ele entra uma vez só e as duas faixas vão para a fila.
  6. `/musica pular` e `/musica parar` funcionam de dentro do canal e são recusados de fora.
  7. Um membro sem cargo é recusado em `tocar`, `pular` e `parar`, e consegue ver a `fila`.
  8. Uma faixa de 25 a 30 minutos toca até o fim (valida o buffer no limite).
  9. Quando todos saem, o bot sai em uns 2 minutos. Quando a fila acaba, sai em uns 5.
  10. Numa sala temporária, quando todos saem, a sala é apagada, o bot sai e o log não mostra erro.
  11. Movido de canal pelo Discord, o bot continua tocando. Movido para um canal vazio, sai em uns 2 minutos.
  12. Depois de `/musica pular` e de `/musica parar`, `docker top severino-bot` mostra só o `docker-init` e o Node: nenhum yt-dlp ou ffmpeg sobrando.
  13. Depois dos itens anteriores, `docker exec severino-bot cat /sys/fs/cgroup/memory.peak /sys/fs/cgroup/pids.peak` fica abaixo dos limites do compose, e `docker exec severino-bot wget -qO- http://127.0.0.1:8080/metrics | grep music` mostra os contadores. Este item vem antes do 14 porque parar o container zera o pico.
  14. Durante uma música, `time docker compose stop severino-bot` leva menos de 20 s e `docker inspect severino-bot --format '{{.State.ExitCode}}'` dá 0, ou seja, saída ordenada e sem SIGKILL. Depois, `docker compose start severino-bot`.
  15. XP de voz: duas pessoas com o bot ganham XP, e uma pessoa sozinha com o bot não ganha. É a regra atual, e o bot não faz companhia.
- [ ] Se algo grave aparecer, voltar com `git -C severino-bot switch main && docker compose up -d --build`. O `BulkOverwrite` do boot apaga o `/musica` sozinho, e os limites maiores do compose podem ficar.
- [ ] Depois de validar: `git -C severino-bot switch main`, merge de `feat/musica` e push. O CI roda typecheck, testes e `npm audit`.

---

## Manutenção

Esta seção também vai para o README do bot (Tarefa 8), que é para onde os alertas apontam.

- **O YouTube mudou algo e as faixas falham** (alerta `SeverinoMusicaFalhando`, log `[música] falha (failure)`):
  1. Pegue a release nova do yt-dlp e o hash dela: `curl -sL https://github.com/yt-dlp/yt-dlp/releases/download/<versão>/SHA2-256SUMS | grep musllinux.zip`.
  2. Atualize `YTDLP_VERSION` e `YTDLP_SHA256` no `Dockerfile`.
  3. Rode `docker compose up -d --build`. O `update.sh` também reconstrói, mas com a versão fixada no `Dockerfile`, então só a troca do passo 2 atualiza o yt-dlp.
- **O YouTube pediu "confirme que não é robô"** (alerta `SeverinoMusicaBloqueada`): o IP de casa foi marcado. Deixe a música parada por algumas horas. Se voltar sempre, há duas saídas, ambas fora do MVP:
  - um provedor de PO token (`bgutil-ytdlp-pot-provider`);
  - cookies de uma conta Google descartável, nunca a pessoal.
- **ffmpeg:** vem do Alpine, numa camada que fica em cache; rebuilds comuns, inclusive os do `update.sh`, não o atualizam. Para atualizar ffmpeg, Node e openssl de uma vez: `docker compose build --pull severino-bot && docker compose up -d`.

## Depois do MVP

- Playlists: `--flat-playlist -J` no link da playlist, até 50 itens.
- Faixas acima de 30 minutos: o buffer deixa de caber a faixa inteira, e o yt-dlp volta a ler no ritmo da música depois que ele enche. Antes de subir o limite, tocar em tempo real uma faixa de mais de 1 hora e ver se ela chega ao fim.
- Volume ou normalização, com filtro do ffmpeg (`volume`, `loudnorm`) aplicado a partir da faixa seguinte.
- Repetir e embaralhar.
- Botões na mensagem "Tocando agora".
- Menos espera até o primeiro som: guardar no `/tmp` o JSON do `-J` do pedido e tocar com `--load-info-json`, sem resolver a faixa de novo. Só se o tempo medido na Tarefa 9 incomodar.

## Medições

Preencher nas Tarefas 1, 7 e 9.

| Medida | Valor |
|---|---|
| Tamanho da imagem antes e depois | 429,1 MB → 748,5 MB com o `.zip` (zipimport: 674,2 MB) |
| `-J` de busca e de link (3a) | `.zip`: busca 3,37–3,61 s, link 4,58–4,72 s (3 rodadas, cache quente). Zipimport: busca 4,71–4,88 s, link 6,02–6,27 s |
| Pico do pior caso no teste, faixa + resolução (3b: `memory.peak`, `pids.peak`) | `.zip`: 388,8 MiB e 21 PIDs no procedimento do plano; 350,4 MiB numa repetição em container novo. Zipimport: 346,3 MiB e 21 PIDs; 323,7 MiB na repetição com o download conferido. Uma resolução sozinha: 262–304 MiB. Quase tudo é memória anônima: o Node que o yt-dlp abre para os desafios chega a 169 MiB (`RssAnon`), cada yt-dlp a 78 MiB (`.zip`) ou 64 MiB (zipimport), o ffmpeg a 13 MiB |
| Limites do compose (pico + bot em repouso + buffer, com folga) | `mem_limit: 640m` e `pids_limit: 200`. Memória: (388,8 + 84 + 40) × 1,25 = 641 MiB, que não cabe nos 512 MiB do plano (sem folga, 512,8 MiB; zipimport, 588 MiB); o dono decidiu subir para 640m em 14/10/2026. PIDs: (21 + 18) × 1,25 ≈ 49, que cabe nos 200 do plano |
| Pico no SDJ depois da checklist (item 13) | |
| Tempo até o primeiro som | Teste, sem Discord: o download leva 4,55–4,90 s até os primeiros 8 KiB de Ogg; somado ao `-J` do pedido, dá uns 8–9,5 s |

Vídeos do teste: `VIDEO` = `dQw4w9WgXcQ` (3:33); `LONGO` = `I03Hs6dwj7E`, 1767 s (29:27) pelo próprio yt-dlp, formato 251 (Opus, 142,9 kb/s, 30,1 MiB). O 3c trouxe a faixa inteira: `ffprobe` com `Duration: 00:29:27.32`, em 25,95 s (`.zip`) e 26,7 s (zipimport).

## Desvios

- **Tarefa 1, portão de memória:** o pico do 3b somado ao bot e ao buffer, com folga, deu 641 MiB, acima dos 512 MiB do Passo 4, e o zipimport também não coube (588 MiB). Quem pesa é o Node que o yt-dlp abre para os desafios do YouTube, 169 MiB por extração. Em 14/10/2026 o dono decidiu subir o limite para 640m e manter o `.zip`, que resolve 1,3 s mais rápido. O resto do desenho não muda.
- **Tarefa 3, `classifyFailure`:** o trecho `not available in your country` da tabela não casa com a mensagem real de bloqueio regional ("The uploader has not made this video available in your country") nem com a do yt-dlp ("…due to geo restriction"). Sem a correção, o bloqueio regional contaria como `failure` e entraria no alerta. O padrão aceita também `not made this video available in your country` e `geo restriction`, ambos testados.
- **Tarefa 4, métricas:** os quatro campos e as quatro definições de música entraram no `metrics.ts` já na Tarefa 4, e não na 7, porque o `recordFailure` os usa e cada commit precisa passar no typecheck.
- **Tarefa 4, grupo de processos:** o yt-dlp e o ffmpeg nascem com `detached: true` (grupo próprio), e o `kill()` e o prazo da resolução sinalizam o grupo inteiro. Sem isso, matar o yt-dlp na extração deixaria órfão o Node que ele abre para os desafios. Testado com um yt-dlp falso, inclusive com um processo que ignora o SIGTERM e morre pelo SIGKILL depois de 2 s.
- **Tarefa 4, log da resolução:** a resolução também registra `[música] falha (<tipo>) ao resolver <alvo>: <última linha>`, porque a resposta de `failure` diz que o erro ficou registrado.
- **Tarefa 4, bancada:** depois de umas 60 extrações em uma hora no IP de casa, o YouTube respondeu "Sign in to confirm you're not a bot" (classificado como `bot-check`). Por isso os caminhos do `kill()` foram testados com um yt-dlp falso, sem o YouTube. Um pico de 415 MiB nessa bancada foi cache de arquivos que o container recarregou (71 MiB de `file`) e não muda a conta dos 640m.
- **Tarefa 5, sessão:** duas adições pequenas. O `startSession` já avalia o timer de "sozinho", para o caso de quem pediu sair enquanto o bot entrava. E os humanos do canal são contados pelo cache de estados de voz, como no `voice.ts`: quem não está no cache conta como humano, e o bot fica. O fluxo foi testado com o `AudioPlayer` real tocando para uma conexão falsa e com o yt-dlp falso, sem Discord e sem YouTube.
- **Tarefa 6, trava:** só o `tocar` usa o `withSessionLock`, como no plano. O `pular` e o `parar` respondem sem esperar a trava (o Discord só espera 3 s, e um `startSession` leva até 20 s); isso é seguro porque o `tocar` não tem `await` entre achar a sessão e pôr a faixa na fila. Como proteção extra, o `enqueue` de uma sessão já encerrada lança erro em vez de abrir processos que ninguém mataria.
- **Tarefa 1, Passo 3:** o container de teste rodou em segundo plano (`--entrypoint sleep … infinity`), com os comandos via `docker exec`, e com `--init`, como o `init: true` do compose. O `time ( … )` virou `time sh -c "…"`, porque o `time` do busybox não mede subshell.
- **Tarefa 1, zipimport:** testado com um `Dockerfile` à parte, fora do worktree (`yt-dlp` da mesma release, SHA-256 `1fa6733c…d4d6` do `SHA2-256SUMS`, mais `apk add python3`). O primeiro 3c dele falhou com `HTTP Error 403: Forbidden`; as duas tentativas seguintes e o 3b repetido baixaram a faixa inteira, então o 403 foi passageiro.
