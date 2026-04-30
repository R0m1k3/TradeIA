FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat make g++ python3 postgresql-client

FROM base AS deps
COPY package*.json ./
RUN npm install

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
EXPOSE 4000
CMD ["npm", "run", "dev"]

FROM base AS production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY package*.json ./

EXPOSE 4000
CMD ["sh", "-c", "until pg_isready -h postgres -p 5439 -U trading; do echo 'Waiting for postgres...'; sleep 1; done; npx prisma migrate deploy && node dist/index.js"]
