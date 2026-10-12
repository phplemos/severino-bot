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

FROM node:24-alpine
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1

COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node scripts/db-roles.sh ./scripts/db-roles.sh

USER node
EXPOSE 8080
# As migrações rodam no serviço severino-migrate do compose, antes do bot subir
CMD ["node", "dist/index.js"]
