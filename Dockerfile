FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci || npm install
RUN npx prisma generate

COPY . .
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --only=production || npm install --omit=dev
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

RUN chown -R node:node /app

USER node

ENV NODE_ENV=production

CMD ["sh", "-c", "npx prisma db push && node dist/index.js"]
