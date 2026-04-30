FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
RUN npm install

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS production
RUN npm install -g serve
COPY --from=build /app/dist ./dist
EXPOSE 51733
CMD ["serve", "-s", "dist", "-l", "51733"]
