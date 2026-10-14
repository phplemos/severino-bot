# Node 24 é LTS com suporte até abril de 2028
FROM node:24-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
ENV CHECKPOINT_DISABLE=1

COPY package.json package-lock.json ./
COPY prisma ./prisma
# npm ci falha se o lockfile não bater com o package.json, em vez de instalar outra coisa em silêncio
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# yt-dlp em pasta, não o binário único: o binário único se extrai no /tmp, que é noexec no container
FROM alpine:3.24 AS ytdlp
ARG YTDLP_VERSION=2026.08.19
ARG YTDLP_SHA256=a8a9761628be455368db73ab54a2858da22342084f300f7e0d50bdcbef2acf82
RUN wget -q -O /tmp/yt-dlp.zip "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_musllinux.zip" \
	&& echo "${YTDLP_SHA256}  /tmp/yt-dlp.zip" | sha256sum -c - \
	&& mkdir -p /opt/yt-dlp && unzip -q /tmp/yt-dlp.zip -d /opt/yt-dlp \
	&& chmod 755 /opt/yt-dlp/yt-dlp_musllinux

FROM node:24-alpine
WORKDIR /app
# ffmpeg converte o áudio do YouTube em Opus para o Discord
RUN apk add --no-cache openssl ffmpeg
ENV NODE_ENV=production CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 YTDLP_PATH=/opt/yt-dlp/yt-dlp_musllinux
COPY --from=ytdlp /opt/yt-dlp /opt/yt-dlp

COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node scripts/db-roles.sh ./scripts/db-roles.sh

USER node
EXPOSE 8080
# As migrações rodam no serviço severino-migrate do compose, antes do bot subir
CMD ["node", "dist/index.js"]
