# Étape 1 : installation des dépendances de production uniquement
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Étape 2 : image finale légère
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY sim ./sim
COPY server ./server
COPY db ./db
COPY demo ./demo
# Procédures métier affichées par l'aide du mode édition
COPY doc/procedures ./doc/procedures
COPY web ./web
# data/ : dossier de travail (volume) — créé ici avec le bon
# propriétaire pour que l'application puisse y copier les démos
RUN mkdir data && chown node:node data
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
