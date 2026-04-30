FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
RUN apk add --no-cache libc6-compat postgresql-client openssl libressl-dev
COPY package*.json ./
RUN npm install

FROM base AS build
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS production
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package*.json ./

EXPOSE 4000

# Commande résiliente : tente une migration propre, sinon force la synchro, puis démarre
CMD (npx prisma migrate deploy || npx prisma db push --skip-generate) && node dist/index.js
