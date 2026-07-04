# Étape 1 : installation des dépendances de production uniquement
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Étape 2 : image finale légère
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY sim ./sim
COPY server ./server
COPY db ./db
COPY data ./data
COPY web ./web
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
