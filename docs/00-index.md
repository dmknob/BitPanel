# BitPanel — Vault de Documentação

Bem-vindo ao vault de documentação do **BitPanel**, um painel de indicadores Bitcoin com backend Node.js e banco de dados SQLite.

---

## Navegação

- [[01-visao-geral-do-projeto|Visão Geral do Projeto]]
- [[02-melhorias-imediatas|Plano de Melhorias Imediatas]]
- [[03-desenvolvimentos-futuros|Plano de Desenvolvimentos Futuros]]

---

## Estado Atual (Maio 2026)

| Item | Status |
|------|--------|
| Backend Node.js + Express | ✅ Funcional |
| Banco SQLite + Workers | ✅ Funcional |
| Frontend PWA + Dark Mode | ✅ Funcional |
| Calculadora DCA | ✅ Funcional |
| Testes automatizados | ❌ Ausentes |
| README.md | ❌ Ausente |
| Cabeçalhos de segurança | ❌ Ausentes |
| Rate limiting | ❌ Ausente |
| Validação de ambiente | ❌ Ausente |

---

## Stack

- **Backend:** Node.js, Express 4, SQLite3, Axios, node-cron, EJS, dotenv
- **Frontend:** Vanilla JS, CSS Grid, Service Worker (PWA), IndexedDB, localStorage
- **Deploy:** PM2, Nginx, shell script de backup
- **APIs externas:** CoinGecko, Mempool.space, Alternative.me
