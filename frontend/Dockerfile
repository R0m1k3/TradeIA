FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
# Supprime la config par défaut
RUN rm /etc/nginx/conf.d/default.conf
# Copie le build
COPY --from=build /app/dist /usr/share/nginx/html
# Config SPA robuste
RUN echo 'server { listen 80; location / { root /usr/share/nginx/html; try_files $uri $uri/ /index.html; } }' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
