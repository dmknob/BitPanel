# BitPanel

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/license-ISC-blue)

**BitPanel — Dashboard Bitcoin em tempo real**

> Screenshot em breve

---

## O que é

BitPanel é um painel de indicadores Bitcoin rodando localmente ou em servidor próprio. Ele consolida em uma única tela os dados mais relevantes para quem acompanha o mercado:

- Preço BTC em **BRL, USD e EUR**
- **Mayer Multiple** (razão preço/MM200)
- **Fear & Greed Index** (Alternative.me)
- **Stock-to-Flow** e desvio do modelo
- **Dominância BTC** no mercado cripto
- **Hash Rate** e **Dificuldade** da rede
- **Taxas de mempool** (baixa, média, alta prioridade)

---

## Funcionalidades

- **PWA** — instalável no celular ou desktop, funciona offline com dados em cache
- **Dark mode** — interface escura por padrão, adaptada para leitura noturna
- **Calculadora DCA** — simule aportes periódicos e veja o preço médio acumulado
- **Calculadora Sats** — converta reais/dólares em satoshis instantaneamente

---

## Pré-requisitos

- **Node.js 18+**
- **API Key gratuita do CoinGecko** — obtenha em <https://www.coingecko.com/api>

---

## Instalação rápida

```bash
git clone https://github.com/dmknob/BitPanel.git
cd BitPanel
cp .env.example .env
# edite .env com sua COINGECKO_API_KEY
npm install
npm start
```

Acesse <http://localhost:3000> no navegador.

---

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta em que o servidor HTTP escuta |
| `DB_NAME` | `bitpanel.sqlite` | Caminho/nome do arquivo SQLite |
| `UPDATE_INTERVAL_SECONDS` | `600` | Intervalo de atualização dos dados (segundos) |
| `COINGECKO_API_KEY` | — | **Obrigatória.** Chave da API CoinGecko |
| `ALLOWED_ORIGIN` | _(vazio)_ | Origem permitida para CORS. Use `*` apenas em dev |
| `SENTRY_DSN` | _(vazio)_ | DSN do Sentry para monitoramento de erros (opcional) |

Consulte [.env.example](.env.example) para o template completo.

---

## Deploy em produção

Veja o guia completo em [DEPLOYMENT.md](DEPLOYMENT.md), que cobre configuração com **PM2** e **Nginx** em um servidor Linux.

Para deploy via **Docker**, use o `docker-compose.yml` incluído:

```bash
cp .env.example .env
# edite .env com suas variáveis
docker compose up -d
```

---

## Testes

```bash
npm test
```

---

## Stack técnica

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 18+ |
| Framework HTTP | Express |
| Banco de dados | SQLite (via `sqlite` + `sqlite3`) |
| Templates | EJS |
| Frontend | Vanilla JS + CSS |
| PWA | Service Worker + Web App Manifest |
| Processo | PM2 |
| Proxy reverso | Nginx |

---

## APIs externas

| API | Uso |
|---|---|
| [CoinGecko](https://www.coingecko.com/api) | Preço BTC, dominância, métricas de mercado |
| [Mempool.space](https://mempool.space/api) | Hash rate, dificuldade, taxas de mempool |
| [Alternative.me](https://alternative.me/crypto/fear-and-greed-index/) | Fear & Greed Index |

---

## Licença

Distribuído sob a licença **ISC**. Veja [LICENSE](LICENSE) para detalhes.
