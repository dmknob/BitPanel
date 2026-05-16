# Stage 1: builder — compila TypeScript e instala dependências de produção
FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./
# Instala todas as deps (incluindo devDeps) para compilar TypeScript
RUN npm ci

COPY tsconfig.json ./
COPY server.ts ./
# Compila TypeScript → dist/server.js
RUN npm run build

# Remove devDeps para imagem final enxuta
RUN npm ci --omit=dev

# Stage 2: runtime — imagem final enxuta
FROM node:18-alpine

WORKDIR /app

# Copia node_modules de produção e código compilado do stage anterior
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Copia o restante do código-fonte (views, static, scripts)
COPY . .

# Cria o diretório persistente para o banco de dados SQLite
RUN mkdir -p /data

ENV NODE_ENV=production \
    DB_NAME=/data/bitpanel.sqlite

EXPOSE 3000

VOLUME ["/data"]

# Executa como usuário não-root por segurança
USER node

CMD ["node", "dist/server.js"]
