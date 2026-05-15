# Stage 1: builder — instala apenas dependências de produção
FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Stage 2: runtime — imagem final enxuta
FROM node:18-alpine

WORKDIR /app

# Copia node_modules já instalados do stage anterior
COPY --from=builder /app/node_modules ./node_modules

# Copia o restante do código-fonte
COPY . .

# Cria o diretório persistente para o banco de dados SQLite
RUN mkdir -p /data

ENV NODE_ENV=production \
    DB_NAME=/data/bitpanel.sqlite

EXPOSE 3000

VOLUME ["/data"]

# Executa como usuário não-root por segurança
USER node

CMD ["node", "server.js"]
