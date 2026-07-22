# Visão Geral do Projeto

tags: #arquitetura #overview

---

## O que é o BitPanel

**BitPanel** é um dashboard Bitcoin full-stack que agrega indicadores on-chain, cotações em tempo real e ferramentas de análise. Funciona como um painel pessoal para acompanhar o mercado Bitcoin sem depender de serviços de terceiros para armazenamento de dados.

---

## Arquitetura

```
┌─────────────────────────────────────────────────────┐
│                     Usuário (Browser)               │
│          PWA · Service Worker · IndexedDB           │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP / SSR
┌──────────────────────▼──────────────────────────────┐
│               Express.js (server.js)                │
│    GET /        GET /dca       GET /api/data        │
│    GET /api/historical-prices                       │
└──────────────────────┬──────────────────────────────┘
                       │ SQL
┌──────────────────────▼──────────────────────────────┐
│                  SQLite (bitpanel.sqlite)            │
│  current_prices · mempool_snapshot                  │
│  btc_daily_close_prices · fear_greed_history        │
│  btc_global_metrics_history                         │
└──────────────────────┬──────────────────────────────┘
                       │ Workers (cron)
┌──────────────────────▼──────────────────────────────┐
│               APIs Externas                         │
│  CoinGecko · Mempool.space · Alternative.me         │
└─────────────────────────────────────────────────────┘
```

---

## Endpoints

| Rota | Método | Descrição |
|------|--------|-----------|
| `/` | GET | Dashboard principal (SSR EJS) |
| `/dca` | GET | Calculadora DCA (SSR EJS) |
| `/api/data` | GET | Dados atuais em cache (JSON) |
| `/api/historical-prices` | GET | Histórico 365 dias (JSON) |

---

## Workers Internos

| Worker | Frequência | Fontes | Descrição / Otimização |
|--------|------------|--------|------------------------|
| `updateHighFrequencyData` | Cada `UPDATE_INTERVAL_SECONDS` (padrão 600s) | CoinGecko, Mempool.space | Preço BTC, USDT, taxas da mempool. |
| `updateDominanceData` | A cada 1 hora | CoinGecko | Dominância do BTC (com cache de 1h no banco para evitar chamadas redundantes). |
| `updateFearGreedData` | Cada `UPDATE_INTERVAL_SECONDS` (padrão 600s) | Alternative.me | Fear & Greed Index (atualizado conforme a data retornada pela API). |
| `updateLatestDailyData` | Diário às 00:15 | CoinGecko | Fechamento diário do dia anterior. |
| `syncHistoricDataOnStartup` | Na inicialização (apenas se DB estiver desatualizado) | CoinGecko (365 dias) | Sincroniza histórico na inicialização se o banco de dados contiver menos de 360 dias ou estiver com dados de mais de 2 dias atrás. |

---

## Estrutura de Arquivos

```
BitPanel/
├── server.js                 # Servidor Express + Workers + DB
├── package.json
├── ecosystem.config.js       # PM2
├── DEPLOYMENT.md             # Guia de deploy completo
├── scripts/
│   └── backup_bitpanel_db.sh # Backup com retenção rotativa
├── static/
│   ├── js/
│   │   ├── common.js         # Dark mode, timestamps, service worker reg.
│   │   ├── dashboard.js      # Fetch API, renderização
│   │   └── dca.js            # Calculadora DCA + IndexedDB
│   ├── style.css
│   ├── sw.js                 # Service Worker PWA
│   └── manifest.json
└── views/
    ├── pages/
    │   ├── index.ejs
    │   └── dca.ejs
    └── partials/
        ├── header.ejs
        └── footer.ejs
```

---

## Relacionado

- [[02-melhorias-imediatas]]
- [[03-desenvolvimentos-futuros]]
