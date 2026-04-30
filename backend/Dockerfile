FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
# Ajout de openssl et des dépendances nécessaires pour Prisma sur Alpine
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
# Important : les libs doivent être présentes aussi en production
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package*.json ./

EXPOSE 4000

# migrate deploy est beaucoup plus stable pour la persistance
CMD npx prisma migrate deploy && node dist/index.js
