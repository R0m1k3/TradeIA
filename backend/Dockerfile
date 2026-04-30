FROM node:20-alpine AS base
WORKDIR /app

# --- Stage 1: Install dependencies ---
FROM base AS deps
RUN apk add --no-cache libc6-compat openssl postgresql-client
COPY package*.json ./
RUN npm install

# --- Stage 2: Build TypeScript + generate Prisma client ---
FROM base AS build
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma generate creates the typed client in node_modules/.prisma/client/
RUN npx prisma generate
RUN npm run build

# --- Stage 3: Production image ---
FROM base AS production
RUN apk add --no-cache libc6-compat openssl postgresql-client
# CRITICAL: copy node_modules from BUILD (not deps) — it contains the generated Prisma client
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package*.json ./

EXPOSE 4000

# migrate deploy is safe and non-destructive: applies only new migrations, never drops existing data.
# We first try to resolve the initial migration for existing databases (it will fail silently if already applied).
CMD npx prisma migrate resolve --applied 20260430000000_init --preview-feature ; npx prisma migrate deploy && node dist/index.js
