# ESTADO — BitPanel

> Documento de handoff. A próxima sessão deve ler **"Estado atual"** primeiro.
> Seções abaixo são duráveis (decisões, armadilhas, arquitetura) — consulte sob demanda.
> Handoffs superados vão para `ESTADO-HISTORICO.md`.

**Última atualização:** 2026-08-27
**Branch oficial:** `main` (produção) · HEAD `cb267bc`

---

## Estado atual

O projeto está **em produção** com todas as ondas 1–3 e F18–F20 no ar. Sobre o
trabalho da IA (F18–F20), o dono do repo aplicou por cima, direto no `main`, duas
mudanças próprias: **troca do driver SQLite para `better-sqlite3`** (ADR-001) e
**rotação de chave CoinGecko** (`COINGECKO_API_KEY_2` opcional com fallback).

**Situação que precisa de atenção:**
- ⚠️ **CI está vermelho.** O último run de CI (commit "Troca de driver SQLite")
  falhou porque `tests/integration/api.test.js` ainda faz `require('sqlite')` e
  `require('sqlite3')`, pacotes que foram **removidos** do `package.json`. Os
  testes de integração precisam migrar para `better-sqlite3` (API síncrona) ou
  reinstalar os pacotes antigos só como devDependency de teste. Os testes
  unitários (`calculateBitcoinSupply`, `stockToFlow`) não são afetados.
- A branch `claude/project-analysis-planning-0kAll` está **obsoleta** (tem o
  driver antigo `sqlite3`+`sqlite`). Não desenvolver mais nela; `main` é a verdade.

**Próximo passo sugerido:** corrigir os testes de integração para `better-sqlite3`
e reverter o CI para verde. Depois disso, nada bloqueia.

---

## Como verificar que a produção está com a versão mais atual

Qualquer um destes confirma:

1. **Campo Lightning no payload** (prova que F20 está no ar):
   `curl -s https://SEU_DOMINIO/api/data | grep lightning` — deve retornar
   `capacity_btc`, `channels`, `nodes`.
2. **Health check:** `curl -s https://SEU_DOMINIO/api/health` → `{ status: "ok", uptime, ... }`.
3. **No servidor:** `git -C /opt/bitpanel log --oneline -1` deve bater com `origin/main` (`cb267bc`).
4. **PM2:** `pm2 info BitPanel` (uptime/restarts) e `pm2 logs BitPanel --lines 50`.
5. **Front:** card "⚡ Lightning Network" visível no dashboard e Service Worker em
   `bitpanel-cache-v5` (DevTools → Application → Cache Storage).

---

## Como o sistema funciona

- **Stack:** Node.js + Express 4 + EJS (SSR) + Vanilla JS/PWA. Backend em
  **TypeScript** (`server.ts`, ~1100 linhas). Banco **SQLite** via
  **`better-sqlite3`** (API síncrona, WAL mode).
- **Execução:**
  - Dev: `npm start` (ou `npm run dev`) → `ts-node server.ts`.
  - Prod: `npm run build` (tsc + copia `views/` e `static/` para `dist/`) → PM2
    roda `dist/server.js` (fork, 1 instância, `max_memory_restart: 120M`).
- **Dados (workers via node-cron v4):**
  - Alta frequência (a cada `UPDATE_INTERVAL_SECONDS`, padrão 600s):
    preços (CoinGecko), mempool/fees/altura (mempool.space), métricas de rede,
    dominância. Ao final, dispara `broadcastUpdate()` (WebSocket).
  - Diário (00:15): Fear & Greed, fechamento diário, Lightning Network.
- **APIs externas:** CoinGecko (preços/histórico/dominância), mempool.space
  (fees/altura/dificuldade/Lightning), alternative.me (Fear & Greed).
- **Tempo real (F19):** `WebSocketServer` (`ws`) anexado ao mesmo servidor HTTP;
  envia `{ type: 'update', data: <payload /api/data> }`. Frontend
  (`dashboard.js`, `tv.js`) conecta via `ws/wss` e cai para polling de 10 min se
  a conexão fechar. `buildDataPayload()` é a fonte única do payload (HTTP + WS).
- **Migrations:** `runMigrations()` via `PRAGMA user_version`, incremental 0→4.
  Migration 4 = tabela `lightning_snapshot`. Roda automaticamente no boot.
- **Estado persistente:** arquivo SQLite (`bitpanel.sqlite`; em Docker
  `/data/bitpanel.sqlite`). **Não versionado** (`.gitignore`) — sobrevive a
  deploys via `git pull`. localStorage guarda carteira; IndexedDB cacheia
  histórico do DCA.

---

## O que já está pronto

- **Ondas 1–2:** segurança (Helmet+CSP, rate-limit, CORS, chave CoinGecko em
  header), infra (Docker multi-stage, docker-compose healthcheck, CI/CD,
  migrations, Sentry opcional), indicadores (S2F, dominância, hash rate,
  dificuldade, gráficos Chart.js), correção do bug de supply (bloco genesis).
- **Onda 3:** carteira/portfolio (F11), alertas push com VAPID (F12), export CSV
  do DCA (F13), comparação DCA vs. hold sem CDI (F14), modo TV/kiosk (F15).
- **F18–F20:** migração TypeScript, WebSockets em tempo real, Lightning Network.
- **Do dono (por cima):** driver `better-sqlite3` (ADR-001), rotação de chave
  CoinGecko com fallback.
- **Testes:** unitários passando; integração quebrado pelo driver (ver armadilhas).

---

## Decisões tomadas

- **Driver SQLite = `better-sqlite3`** (síncrono, WAL). Motivo: `sqlite3` v6+ exige
  `GLIBC_2.38`, incompatível com o servidor de produção (Debian/Ubuntu LTS).
  Documentado em `docs/adr/ADR-001-db-driver.md`. `sqlite` e `sqlite3` foram
  **removidos** — não reintroduzir no código de produção.
- **Migrations sem dependência externa** — `PRAGMA user_version` nativo, não Knex.
- **Push notifications opcionais** — só ativam se `VAPID_*` estiverem no `.env`.
- **Sentry opcional** — só ativa com `SENTRY_DSN`.
- **DCA F14 sem API de CDI** — comparação apenas contra manter caixa (sem juros).
- **`dist/` não versionado** — gerado no deploy por `npm run build`.
- **Chart.js via CDN** (`cdn.jsdelivr.net` liberado no CSP).

## Decisões pendentes

- **Como corrigir os testes de integração** para `better-sqlite3`: migrar o setup
  do teste para API síncrona (recomendado) **ou** adicionar `sqlite`/`sqlite3`
  como devDependency só de teste (mais simples, mas mantém dois drivers).
- **CoinGecko `COINGECKO_API_KEY_2`** — definir se será provisionada em produção
  (o fallback só tem efeito com a 2ª chave presente).

## Fora de escopo (por ora)

- Glassnode / métricas on-chain avançadas (custo de API).
- API de CDI na comparação do DCA (decisão explícita do dono).
- Multi-instância/cluster no PM2 (fork 1 instância é suficiente).

---

## Armadilhas operacionais

- **CI vermelho por driver nos testes** (ver "Estado atual"). `npm ci` no `main`
  não instala `sqlite`/`sqlite3`, então `require('sqlite')` no teste de integração
  quebra. Corrigir antes de confiar no gate de CI.
- **`better-sqlite3` é síncrono** — nada de `await` em `db.get/all/run`. Ao editar
  `server.ts`, seguir o mapa de API no ADR-001 (`.get(...params)`,
  `result.lastInsertRowid`, `db.pragma(...)`, sem `finalize()`).
- **Build precisa copiar assets** — `npm run build` = `tsc && cp -r views dist/views
  && cp -r static dist/static`. Rodar `node dist/server.js` sem esse copy quebra
  as views/estáticos. (No macOS/Linux o `cp -r` funciona; em Windows ajustar.)
- **SQLite de produção não é versionado** — nunca sobrescrever `/data/bitpanel.sqlite`
  num deploy. `git pull` não o toca; cuidado com scripts que limpam o diretório.
- **Migration é irreversível para trás** — `user_version` só sobe. Testar migration
  nova em cópia do banco antes de subir.
- **Deploy compila no servidor** — o workflow faz `npm ci && npm run build &&
  npm ci --omit=dev`. `better-sqlite3` recompila binário nativo no `npm ci`;
  garantir toolchain (python/make/g++) no servidor.
- **GLIBC** — não voltar para `sqlite3` v6+ no servidor atual (quebra no boot).

---

## Referências

- `docs/adr/ADR-001-db-driver.md` — decisão do driver + mapa de API.
- `DEPLOYMENT.md` — passos de deploy no VPS.
- `docs/` — vault Obsidian (visão geral, melhorias, roadmap).
- `.github/workflows/` — `ci.yml` (test+typecheck+lint), `deploy.yml` (SSH+PM2).
