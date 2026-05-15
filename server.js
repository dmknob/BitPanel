// 1. Imports
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cron = require('node-cron');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Sentry (opcional — ativo somente se SENTRY_DSN estiver definido no .env)
let Sentry = null;
if (process.env.SENTRY_DSN) {
    Sentry = require('@sentry/node');
    Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });
}

// --- VARIÁVEIS GLOBAIS ---
let db;
let initialDataLoadPromise = null;

// --- CONFIGURAÇÃO DE INTERVALO ---
const UPDATE_INTERVAL_SECONDS = parseInt(process.env.UPDATE_INTERVAL_SECONDS) || 600;
const UPDATE_INTERVAL_MS = UPDATE_INTERVAL_SECONDS * 1000;
const cronIntervalMinutes = Math.max(1, Math.round(UPDATE_INTERVAL_SECONDS / 60));
const CRON_SCHEDULE_HIGH_FREQUENCY = `*/${cronIntervalMinutes} * * * *`;

// --- VALIDAÇÃO DE VARIÁVEIS DE AMBIENTE ---
function validateEnv() {
    const required = ['COINGECKO_API_KEY'];
    const missing = required.filter(k => !process.env[k] || process.env[k] === 'SUA_API_KEY_AQUI');
    if (missing.length) {
        console.error(`ERRO CRÍTICO: Variáveis de ambiente obrigatórias não definidas ou com valor padrão: ${missing.join(', ')}`);
        process.exit(1);
    }
}

// --- CLIENTE HTTP COM TIMEOUT ---
const httpClient = axios.create({ timeout: 10_000 });

const COINGECKO_HEADERS = () => ({ 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY });

async function fetchWithRetry(url, options = {}, retries = 3) {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            return await httpClient.get(url, options);
        } catch (err) {
            if (attempt === retries - 1) throw err;
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
    }
}

// --- BANCO DE DADOS + MIGRATIONS ---
async function initializeDatabase() {
    try {
        db = await open({
            filename: path.join(__dirname, process.env.DB_NAME || 'bitpanel.sqlite'),
            driver: sqlite3.Database
        });
        await runMigrations(db);
        console.log("Banco de dados SQLite conectado e atualizado.");
    } catch (error) {
        console.error("Erro ao inicializar o banco de dados SQLite:", error);
        process.exit(1);
    }
}

async function runMigrations(db) {
    const { user_version: version } = await db.get('PRAGMA user_version');

    if (version < 1) {
        await db.exec(`
            CREATE TABLE IF NOT EXISTS current_prices (
                symbol TEXT PRIMARY KEY,
                price REAL NOT NULL,
                last_updated INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS mempool_snapshot (
                id INTEGER PRIMARY KEY DEFAULT 1,
                fastest_fee INTEGER,
                half_hour_fee INTEGER,
                hour_fee INTEGER,
                block_height INTEGER,
                tx_count INTEGER,
                calculated_supply REAL,
                last_updated INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS btc_global_metrics_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                market_cap_usd REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS btc_daily_close_prices (
                date TEXT PRIMARY KEY,
                price_usd REAL NOT NULL,
                price_brl REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS fear_greed_history (
                date TEXT PRIMARY KEY,
                value INTEGER NOT NULL,
                classification TEXT NOT NULL,
                last_updated INTEGER NOT NULL
            );
        `);
        await db.run('PRAGMA user_version = 1');
        console.log("Migration 1: Schema inicial criado.");
    }

    if (version < 2) {
        await db.exec(`
            CREATE TABLE IF NOT EXISTS network_metrics_snapshot (
                id INTEGER PRIMARY KEY DEFAULT 1,
                hash_rate_eh_s REAL,
                difficulty REAL,
                difficulty_change_pct REAL,
                avg_block_time_seconds REAL,
                last_updated INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS btc_dominance_snapshot (
                id INTEGER PRIMARY KEY DEFAULT 1,
                dominance_pct REAL NOT NULL,
                last_updated INTEGER NOT NULL
            );
        `);
        await db.run('PRAGMA user_version = 2');
        console.log("Migration 2: Tabelas de rede e dominância criadas.");
    }
}

// --- FUNÇÕES PURAS DE CÁLCULO ---

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

function calculateStockToFlow(supply, blockHeight) {
    const halvingInterval = 210_000;
    const epoch = Math.floor(blockHeight / halvingInterval);
    const blockReward = 50 / Math.pow(2, epoch);
    // ~6 blocos/hora * 24h * 365 dias = 52.560 blocos/ano
    const annualFlow = blockReward * 52_560;
    if (annualFlow <= 0) return null;
    return supply / annualFlow;
}

// --- WORKERS ---

async function updateHighFrequencyData() {
    const ts = new Date().toLocaleString('pt-BR');
    console.log(`[${ts}] Worker: Buscando dados de alta frequência (Preços, Mempool)...`);
    try {
        const [pricesRes, feesRes, heightRes, mempoolRes] = await Promise.all([
            fetchWithRetry('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,tether&vs_currencies=usd,brl,eur', { headers: COINGECKO_HEADERS() }),
            fetchWithRetry('https://mempool.space/api/v1/fees/recommended'),
            fetchWithRetry('https://mempool.space/api/blocks/tip/height'),
            fetchWithRetry('https://mempool.space/api/mempool'),
        ]);

        const now = Date.now();
        const p = pricesRes.data;
        const btcUsd = p?.bitcoin?.usd;
        const btcBrl = p?.bitcoin?.brl;
        const btcEur = p?.bitcoin?.eur ?? null;
        const usdtBrl = p?.tether?.brl;

        if (typeof btcUsd !== 'number' || typeof btcBrl !== 'number') {
            throw new Error(`Resposta CoinGecko incompleta: ${JSON.stringify(p)}`);
        }

        await db.run('INSERT OR REPLACE INTO current_prices (symbol, price, last_updated) VALUES (?,?,?)', ['BTC-USD', btcUsd, now]);
        await db.run('INSERT OR REPLACE INTO current_prices (symbol, price, last_updated) VALUES (?,?,?)', ['BTC-BRL', btcBrl, now]);
        await db.run('INSERT OR REPLACE INTO current_prices (symbol, price, last_updated) VALUES (?,?,?)', ['BTC-EUR', btcEur, now]);
        await db.run('INSERT OR REPLACE INTO current_prices (symbol, price, last_updated) VALUES (?,?,?)', ['USDT-BRL', usdtBrl, now]);

        const blockHeight = heightRes.data;
        const supply = calculateBitcoinSupply(blockHeight);
        const marketCap = btcUsd * supply;

        await db.run(
            `INSERT OR REPLACE INTO mempool_snapshot (id, fastest_fee, half_hour_fee, hour_fee, block_height, tx_count, calculated_supply, last_updated) VALUES (1,?,?,?,?,?,?,?)`,
            [feesRes.data.fastestFee, feesRes.data.halfHourFee, feesRes.data.hourFee, blockHeight, mempoolRes.data.count, supply, now]
        );
        await db.run('INSERT INTO btc_global_metrics_history (timestamp, market_cap_usd) VALUES (?,?)', [now, marketCap]);
        console.log(`[${ts}] Worker: Dados de alta frequência salvos com sucesso.`);
    } catch (err) {
        console.error(`[${ts}] Worker: ERRO ao buscar dados de alta frequência:`, err.message);
        if (Sentry) Sentry.captureException(err);
    }
}

async function updateNetworkMetrics() {
    const ts = new Date().toLocaleString('pt-BR');
    console.log(`[${ts}] Worker: Buscando métricas de rede Bitcoin...`);
    try {
        const res = await fetchWithRetry('https://mempool.space/api/v1/difficulty-adjustment');
        const d = res.data;
        const timeAvgSeconds = (d.timeAvg || 600_000) / 1000;
        const difficulty = d.currentDifficulty;
        // Hash rate em EH/s: (difficulty * 2^32) / timeAvgSegundos / 1e18
        const hashRateEHs = (difficulty * Math.pow(2, 32)) / (timeAvgSeconds * 1e18);
        const difficultyChangePct = d.difficultyChange ?? null;

        await db.run(
            `INSERT OR REPLACE INTO network_metrics_snapshot (id, hash_rate_eh_s, difficulty, difficulty_change_pct, avg_block_time_seconds, last_updated) VALUES (1,?,?,?,?,?)`,
            [hashRateEHs, difficulty, difficultyChangePct, timeAvgSeconds, Date.now()]
        );
        console.log(`[${ts}] Worker: Métricas de rede salvas. Hash rate: ${hashRateEHs.toFixed(2)} EH/s`);
    } catch (err) {
        console.error(`[${ts}] Worker: ERRO ao buscar métricas de rede:`, err.message);
        if (Sentry) Sentry.captureException(err);
    }
}

async function updateDominanceData() {
    const ts = new Date().toLocaleString('pt-BR');
    console.log(`[${ts}] Worker: Buscando dominância do Bitcoin...`);
    try {
        const res = await fetchWithRetry('https://api.coingecko.com/api/v3/global', { headers: COINGECKO_HEADERS() });
        const dominancePct = res.data?.data?.market_cap_percentage?.btc;
        if (typeof dominancePct !== 'number') throw new Error('Dominância não retornada pela API');

        await db.run(
            `INSERT OR REPLACE INTO btc_dominance_snapshot (id, dominance_pct, last_updated) VALUES (1,?,?)`,
            [dominancePct, Date.now()]
        );
        console.log(`[${ts}] Worker: Dominância BTC: ${dominancePct.toFixed(2)}%`);
    } catch (err) {
        console.error(`[${ts}] Worker: ERRO ao buscar dominância:`, err.message);
        if (Sentry) Sentry.captureException(err);
    }
}

async function updateFearGreedData() {
    const ts = new Date().toLocaleString('pt-BR');
    try {
        console.log(`[${ts}] Worker: Buscando Fear & Greed Index...`);
        const res = await fetchWithRetry('https://api.alternative.me/fng/?limit=1&format=json');
        const fng = res.data.data[0];
        const today = new Date().toISOString().split('T')[0];
        await db.run(
            'INSERT OR REPLACE INTO fear_greed_history (date, value, classification, last_updated) VALUES (?,?,?,?)',
            [today, fng.value, fng.value_classification, Date.now()]
        );
        console.log(`[${ts}] Worker: Fear & Greed Index salvo para ${today}.`);
    } catch (err) {
        console.error(`[${ts}] Worker: ERRO ao buscar Fear & Greed:`, err.message);
        if (Sentry) Sentry.captureException(err);
    }
}

async function syncHistoricDataOnStartup() {
    const ts = new Date().toLocaleString('pt-BR');
    console.log(`[${ts}] Worker (Inicialização): Sincronizando histórico de preços (USD & BRL)...`);
    try {
        const [usdRes, brlRes] = await Promise.all([
            fetchWithRetry('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365&interval=daily', { headers: COINGECKO_HEADERS() }),
            fetchWithRetry('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=brl&days=365&interval=daily', { headers: COINGECKO_HEADERS() }),
        ]);

        const usdPrices = usdRes.data.prices;
        const brlPrices = brlRes.data.prices;

        if (!usdPrices?.length || !brlPrices?.length) {
            throw new Error("Histórico vazio retornado pela CoinGecko.");
        }

        const combined = new Map();
        for (const [ts, price] of usdPrices) {
            const date = new Date(ts).toISOString().split('T')[0];
            combined.set(date, { date, price_usd: price });
        }
        for (const [ts, price] of brlPrices) {
            const date = new Date(ts).toISOString().split('T')[0];
            if (combined.has(date)) combined.get(date).price_brl = price;
        }

        const stmt = await db.prepare('INSERT OR IGNORE INTO btc_daily_close_prices (date, price_usd, price_brl) VALUES (?,?,?)');
        let inserted = 0;
        for (const row of combined.values()) {
            if (row.price_usd && row.price_brl) {
                const r = await stmt.run(row.date, row.price_usd, row.price_brl);
                if (r.changes > 0) inserted++;
            }
        }
        await stmt.finalize();
        console.log(`[${ts}] Worker (Inicialização): ${inserted} novos registros históricos adicionados.`);
    } catch (err) {
        console.error(`[${ts}] Worker (Inicialização): ERRO ao sincronizar histórico:`, err.message);
        if (Sentry) Sentry.captureException(err);
    }
}

async function updateLatestDailyData() {
    const ts = new Date().toLocaleString('pt-BR');
    console.log(`[${ts}] Worker (Diário): Buscando fechamento de ontem...`);
    try {
        const [usdRes, brlRes] = await Promise.all([
            fetchWithRetry('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=2&interval=daily', { headers: COINGECKO_HEADERS() }),
            fetchWithRetry('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=brl&days=2&interval=daily', { headers: COINGECKO_HEADERS() }),
        ]);

        const usdPrices = usdRes.data.prices;
        const brlPrices = brlRes.data.prices;
        if (usdPrices?.length > 1 && brlPrices?.length > 1) {
            const yesterday = usdPrices[usdPrices.length - 2];
            const date = new Date(yesterday[0]).toISOString().split('T')[0];
            const priceUsd = yesterday[1];
            const priceBrl = brlPrices[brlPrices.length - 2][1];
            const r = await db.run('INSERT OR IGNORE INTO btc_daily_close_prices (date, price_usd, price_brl) VALUES (?,?,?)', [date, priceUsd, priceBrl]);
            if (r.changes > 0) {
                console.log(`[${ts}] Worker (Diário): Novo fechamento adicionado para ${date}.`);
            } else {
                console.log(`[${ts}] Worker (Diário): Preço para ${date} já atualizado.`);
            }
        }
    } catch (err) {
        console.error(`[${ts}] Worker (Diário): ERRO ao buscar fechamento diário:`, err.message);
        if (Sentry) Sentry.captureException(err);
    }
}

// --- AGENDADORES ---

function scheduleHighFrequencyWorker() {
    console.log(`Agendando worker de alta frequência a cada ${cronIntervalMinutes} minutos.`);
    cron.schedule(CRON_SCHEDULE_HIGH_FREQUENCY, () => {
        updateHighFrequencyData();
        updateNetworkMetrics();
        updateDominanceData();
    });
}

function scheduleDailyWorker() {
    cron.schedule('15 0 * * *', () => {
        const ts = new Date().toLocaleString('pt-BR');
        console.log(`[${ts}] SCHEDULE: Disparando workers diários...`);
        updateFearGreedData();
        updateLatestDailyData();
    });
}

// --- SERVIDOR EXPRESS ---

const app = express();
const PORT = process.env.PORT || 3000;

// Sentry request handler (deve ser o primeiro middleware)
if (Sentry) app.use(Sentry.Handlers.requestHandler());

// Segurança: Helmet com CSP configurado para as fontes externas usadas
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://www.googletagmanager.com",
                "https://www.google-analytics.com",
                "https://cdn.jsdelivr.net",
            ],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://www.google-analytics.com", "https://region1.google-analytics.com"],
            fontSrc: ["'self'"],
            frameSrc: ["'none'"],
        },
    },
}));

// CORS: restritivo por padrão, configurável via ALLOWED_ORIGIN no .env
const allowedOrigin = process.env.ALLOWED_ORIGIN;
if (allowedOrigin) {
    app.use(cors({ origin: allowedOrigin }));
}

// Rate limiting: máximo 60 requisições por minuto por IP nos endpoints /api/
const apiLimiter = rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas requisições. Tente novamente em breve.' },
});
app.use('/api/', apiLimiter);

// Arquivos estáticos e template engine
app.use(express.static(path.join(__dirname, 'static')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- ENDPOINTS DE API ---

app.get('/api/health', async (req, res) => {
    try {
        await db.get('SELECT 1');
        res.json({ status: 'ok', timestamp: Date.now(), uptime: process.uptime() });
    } catch {
        res.status(503).json({ status: 'error', timestamp: Date.now() });
    }
});

app.get('/api/data', async (req, res) => {
    const ts = new Date().toLocaleString('pt-BR');
    console.log(`[${ts}] API /api/data: requisição recebida.`);
    try {
        const mempool = await db.get('SELECT * FROM mempool_snapshot WHERE id = 1');
        if (!mempool) {
            console.log(`[${ts}] API: Cache vazio. Aguardando carga inicial...`);
            await initialDataLoadPromise;
        }

        const [prices, fearGreed, globalMetrics, dailyPrices, freshMempool, networkMetrics, dominance] = await Promise.all([
            db.all('SELECT * FROM current_prices'),
            db.get('SELECT * FROM fear_greed_history ORDER BY date DESC LIMIT 1'),
            db.get('SELECT * FROM btc_global_metrics_history ORDER BY timestamp DESC LIMIT 1'),
            db.all('SELECT price_usd FROM btc_daily_close_prices ORDER BY date DESC LIMIT 200'),
            db.get('SELECT * FROM mempool_snapshot WHERE id = 1'),
            db.get('SELECT * FROM network_metrics_snapshot WHERE id = 1').catch(() => null),
            db.get('SELECT * FROM btc_dominance_snapshot WHERE id = 1').catch(() => null),
        ]);

        const priceMap = Object.fromEntries((prices || []).map(p => [p.symbol, p.price]));
        const currentBtcUsd = priceMap['BTC-USD'];

        let mayer_multiple = null;
        if (currentBtcUsd && dailyPrices?.length >= 200) {
            const sma200 = dailyPrices.reduce((s, r) => s + r.price_usd, 0) / 200;
            mayer_multiple = currentBtcUsd / sma200;
        }

        const supply = freshMempool?.calculated_supply;
        const blockHeight = freshMempool?.block_height;
        const s2f_ratio = (supply && blockHeight != null) ? calculateStockToFlow(supply, blockHeight) : null;

        const lastUpdateTimestamp = freshMempool?.last_updated || Date.now();
        const timeUntilNextUpdate = (lastUpdateTimestamp + UPDATE_INTERVAL_MS) - Date.now();

        res.json({
            lastUpdateTimestamp,
            timeUntilNextUpdate,
            prices: {
                btc_usd: priceMap['BTC-USD'],
                btc_brl: priceMap['BTC-BRL'],
                btc_eur: priceMap['BTC-EUR'],
                usdt_brl: priceMap['USDT-BRL'],
            },
            mempool: {
                fastest_fee: freshMempool?.fastest_fee,
                half_hour_fee: freshMempool?.half_hour_fee,
                hour_fee: freshMempool?.hour_fee,
                block_height: freshMempool?.block_height,
                tx_count: freshMempool?.tx_count,
                calculated_supply: freshMempool?.calculated_supply,
            },
            fearGreed: {
                value: fearGreed?.value,
                classification: fearGreed?.classification,
                last_updated: fearGreed?.last_updated,
            },
            globalMetrics: {
                market_cap_usd: globalMetrics?.market_cap_usd,
                mayer_multiple,
                btc_dominance_pct: dominance?.dominance_pct ?? null,
                s2f_ratio,
            },
            network: {
                hash_rate_eh_s: networkMetrics?.hash_rate_eh_s ?? null,
                difficulty: networkMetrics?.difficulty ?? null,
                difficulty_change_pct: networkMetrics?.difficulty_change_pct ?? null,
                avg_block_time_seconds: networkMetrics?.avg_block_time_seconds ?? null,
                last_updated: networkMetrics?.last_updated ?? null,
            },
        });
    } catch (err) {
        console.error("Erro no endpoint /api/data:", err);
        if (Sentry) Sentry.captureException(err);
        res.status(500).json({ error: "Falha ao processar a requisição." });
    }
});

app.get('/api/historical-prices', async (req, res) => {
    const ts = new Date().toLocaleString('pt-BR');
    const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 365));
    console.log(`[${ts}] API /api/historical-prices: ${days} dias.`);
    try {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = startDate.toISOString().split('T')[0];
        const data = await db.all(
            'SELECT date, price_usd, price_brl FROM btc_daily_close_prices WHERE date >= ? ORDER BY date ASC',
            [startDateStr]
        );
        res.json(data);
    } catch (err) {
        console.error("Erro ao buscar histórico:", err);
        if (Sentry) Sentry.captureException(err);
        res.status(500).json({ error: "Falha ao buscar dados históricos." });
    }
});

app.get('/api/fear-greed-history', async (req, res) => {
    try {
        const data = await db.all(
            'SELECT date, value, classification FROM fear_greed_history ORDER BY date DESC LIMIT 90'
        );
        res.json(data.reverse());
    } catch (err) {
        console.error("Erro ao buscar histórico Fear & Greed:", err);
        if (Sentry) Sentry.captureException(err);
        res.status(500).json({ error: "Falha ao buscar histórico do Fear & Greed." });
    }
});

// --- ROTAS DE PÁGINAS ---

app.get('/', (req, res) => {
    res.render('pages/index', {
        page: 'dashboard',
        title: 'BitPanel | Preço Bitcoin, Indicadores e Cotação em Tempo Real',
        description: 'Acompanhe o preço do Bitcoin (BTC) em tempo real, indicadores on-chain como o Múltiplo de Mayer, o Índice de Medo e Ganância (Fear & Greed) e as taxas da rede. Seu painel completo para a cotação do BTC.',
    });
});

app.get('/dca', (req, res) => {
    res.render('pages/dca', {
        page: 'dca',
        title: 'Calculadora DCA de Bitcoin | Simule Dollar Cost Averaging',
        description: 'Use a calculadora de DCA (Dollar Cost Averaging) para simular o resultado de aportes recorrentes em Bitcoin (BTC), em Reais (BRL) ou Dólares (USD). Descubra o melhor dia da semana ou do mês para comprar Bitcoin.',
    });
});

// --- HANDLERS DE ERRO ---

// Sentry error handler (antes dos handlers 404/500)
if (Sentry) app.use(Sentry.Handlers.errorHandler());

// 404
app.use((req, res) => {
    res.status(404).render('pages/404', {
        page: 'error',
        title: 'Página não encontrada | BitPanel',
        description: '',
    });
});

// 500
app.use((err, req, res, next) => {
    console.error("Erro interno:", err);
    res.status(500).render('pages/500', {
        page: 'error',
        title: 'Erro interno | BitPanel',
        description: '',
    });
});

// --- INICIALIZAÇÃO ---

async function startServer() {
    validateEnv();
    await initializeDatabase();
    app.listen(PORT, () => {
        console.log(`Servidor rodando em http://localhost:${PORT}`);
        scheduleHighFrequencyWorker();
        scheduleDailyWorker();
        console.log("Workers agendados. Disparando carga inicial de dados...");
        initialDataLoadPromise = Promise.all([
            updateFearGreedData(),
            updateHighFrequencyData(),
            updateNetworkMetrics(),
            updateDominanceData(),
            syncHistoricDataOnStartup(),
        ]);
    });
}

startServer();
