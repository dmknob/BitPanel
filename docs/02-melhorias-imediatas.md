# Plano de Melhorias Imediatas

tags: #plano #melhorias #backlog

> Melhorias que podem ser implementadas **agora**, sem mudança de arquitetura. Foco em qualidade, segurança e confiabilidade do código existente.

---

## Prioridade 1 — Segurança (Alta urgência)

### M1 · Cabeçalhos de segurança HTTP com Helmet.js

**Problema:** O Express está exposto sem cabeçalhos de segurança padrão. Navegadores não recebem proteções como `X-Frame-Options`, `X-Content-Type-Options`, `Content-Security-Policy`, `Strict-Transport-Security` etc.

**Impacto:** Vulnerabilidade a clickjacking, MIME sniffing, XSS via injeção de recursos.

**Solução:**
```bash
npm install helmet
```
```js
const helmet = require('helmet');
app.use(helmet());
```

**Esforço:** 30 minutos.

---

### M2 · Rate Limiting nos endpoints de API

**Problema:** `GET /api/data` e `GET /api/historical-prices` não têm limite de requisições. Um script malicioso pode sobrecarregar o servidor ou o banco.

**Solução:**
```bash
npm install express-rate-limit
```
```js
const rateLimit = require('express-rate-limit');
const apiLimiter = rateLimit({ windowMs: 60_000, max: 60 });
app.use('/api/', apiLimiter);
```

**Esforço:** 30 minutos.

---

### M3 · CORS restritivo

**Problema:** `app.use(cors())` permite qualquer origem. Para um painel pessoal, isso não é necessário.

**Solução:**
```js
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || false }));
```
Adicionar `ALLOWED_ORIGIN` ao `.env`. Se não definido, CORS fica desativado (acesso apenas pelo mesmo domínio).

**Esforço:** 15 minutos.

---

### M4 · Chave de API não exposta em logs

**Problema:** A `COINGECKO_API_KEY` é concatenada diretamente na URL da requisição. Se o Express logar URLs de saída (ex: via middleware de debug), a chave aparece nos logs em texto plano.

**Solução:** Usar o campo `headers` do Axios em vez de query string:
```js
axios.get('https://api.coingecko.com/api/v3/...', {
    headers: { 'x-cg-demo-api-key': coingeckoApiKey }
});
```

**Esforço:** 20 minutos.

---

## Prioridade 2 — Confiabilidade (Alta urgência)

### M5 · Timeout nas chamadas Axios

**Problema:** Os `axios.get()` dos workers não têm timeout. Se uma API externa travar (sem responder), o worker fica preso indefinidamente, bloqueando o loop do Node.js.

**Solução:**
```js
const httpClient = axios.create({ timeout: 10_000 }); // 10 segundos
```

**Esforço:** 15 minutos.

---

### M6 · Validação das variáveis de ambiente na inicialização

**Problema:** Se `COINGECKO_API_KEY` não estiver definida, o servidor sobe normalmente, os workers falham silenciosamente e o painel fica com dados vazios por horas até alguém perceber.

**Solução:** Validar no início de `startServer()`:
```js
const REQUIRED_ENV = ['COINGECKO_API_KEY'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
    console.error(`ERRO: Variáveis de ambiente obrigatórias não definidas: ${missing.join(', ')}`);
    process.exit(1);
}
```

**Esforço:** 20 minutos.

---

### M7 · Endpoint de health check

**Problema:** Não há endpoint para monitoramento externo (UptimeRobot, healthchecks.io, PM2 Plus, etc.) confirmar que o servidor está vivo e o banco está acessível.

**Solução:**
```js
app.get('/api/health', async (req, res) => {
    try {
        await db.get('SELECT 1');
        res.json({ status: 'ok', timestamp: Date.now() });
    } catch {
        res.status(503).json({ status: 'error', timestamp: Date.now() });
    }
});
```

**Esforço:** 20 minutos.

---

### M8 · Retry com backoff exponencial nas chamadas de API

**Problema:** Qualquer falha transitória em CoinGecko, Mempool.space ou Alternative.me faz o worker falhar completamente e esperar até o próximo ciclo (até 10 minutos).

**Solução:** Implementar função de retry simples:
```js
async function fetchWithRetry(url, options = {}, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            return await axios.get(url, options);
        } catch (e) {
            if (i === retries - 1) throw e;
            await new Promise(r => setTimeout(r, 1000 * 2 ** i));
        }
    }
}
```

**Esforço:** 45 minutos.

---

## Prioridade 3 — Qualidade do Código (Média urgência)

### M9 · Bug em `calculateBitcoinSupply` nos blocos de halving

**Problema:** A função tem um erro sutil: quando `blockHeight` é exatamente múltiplo de 210.000 (momento do halving), ela adiciona 25 BTC a mais na contagem. O `supply += 50` no final foi concebido para o bloco genesis, mas a lógica do loop já cobre o período correto para a maioria dos blocos, e quebra exatamente nos halvings.

**Bloco atual:** ~896.000 (pós-4º halving) → erro acumulado: ~75 BTC a mais, que é desprezível, mas indica má lógica.

**Solução correta:**
```js
function calculateBitcoinSupply(blockHeight) {
    let supply = 0;
    let reward = 50;
    const halvingInterval = 210_000;
    let blocksRemaining = blockHeight + 1; // inclui o bloco genesis (altura 0)
    while (blocksRemaining > 0 && reward >= 1e-9) {
        const blocksInEpoch = Math.min(blocksRemaining, halvingInterval);
        supply += blocksInEpoch * reward;
        reward /= 2;
        blocksRemaining -= blocksInEpoch;
    }
    return supply;
}
```

**Esforço:** 30 minutos.

---

### M10 · README.md completo

**Problema:** Não existe `README.md`. Qualquer desenvolvedor ou colaborador que acesse o repositório não encontra documentação inicial.

**Conteúdo mínimo:**
- O que é o BitPanel
- Screenshot do dashboard
- Pré-requisitos (Node.js 18+, API Key CoinGecko)
- Como instalar e rodar localmente (`npm install && cp .env.example .env && npm start`)
- Variáveis de ambiente disponíveis
- Link para `DEPLOYMENT.md`

**Esforço:** 1 hora.

---

### M11 · Arquivo `.env.example`

**Problema:** Não existe arquivo de exemplo de variáveis de ambiente. Novos colaboradores precisam adivinhar quais variáveis configurar.

**Solução:** Criar `.env.example`:
```
PORT=3000
DB_NAME=bitpanel.sqlite
UPDATE_INTERVAL_SECONDS=600
COINGECKO_API_KEY=SUA_API_KEY_AQUI
ALLOWED_ORIGIN=https://seudominio.com
```

**Esforço:** 10 minutos.

---

### M12 · Páginas de erro 404 e 500

**Problema:** Rotas inválidas retornam o erro padrão do Express (stack trace em HTML) — feio e potencialmente expõe informações.

**Solução:**
```js
// 404
app.use((req, res) => res.status(404).render('pages/404'));
// 500
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).render('pages/500');
});
```

**Esforço:** 45 minutos (criar as views + middleware).

---

## Resumo de Esforço Total

| ID | Melhoria | Esforço | Prioridade |
|----|----------|---------|-----------|
| M1 | Helmet.js (headers HTTP) | 30 min | 🔴 Alta |
| M2 | Rate limiting | 30 min | 🔴 Alta |
| M3 | CORS restritivo | 15 min | 🔴 Alta |
| M4 | API key fora das URLs | 20 min | 🔴 Alta |
| M5 | Timeout Axios | 15 min | 🟠 Alta |
| M6 | Validação de .env | 20 min | 🟠 Alta |
| M7 | Health check endpoint | 20 min | 🟠 Alta |
| M8 | Retry com backoff | 45 min | 🟠 Média |
| M9 | Bug calculateBitcoinSupply | 30 min | 🟡 Média |
| M10 | README.md | 60 min | 🟡 Média |
| M11 | .env.example | 10 min | 🟡 Média |
| M12 | Páginas 404 / 500 | 45 min | 🟡 Baixa |

**Total estimado: ~6 horas de trabalho focado.**

---

## Relacionado

- [[01-visao-geral-do-projeto]]
- [[03-desenvolvimentos-futuros]]
