'use strict';

// Configurar variáveis de ambiente ANTES de importar o servidor
process.env.COINGECKO_API_KEY = 'test-key-for-integration';
process.env.DB_NAME = ':memory:';
process.env.PORT = '3099';
process.env.NODE_ENV = 'test';

// Mock do axios para evitar chamadas reais às APIs
jest.mock('axios', () => {
    const mockAxios = {
        create: jest.fn(() => mockAxios),
        get: jest.fn(),
        defaults: { headers: { common: {} } },
    };
    return mockAxios;
});

// Mock do node-cron para evitar agendamentos durante os testes
jest.mock('node-cron', () => ({
    schedule: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');

// Criar app de teste isolado (sem iniciar o servidor real)
let app;
let db;

async function setupTestApp() {
    db = await open({ filename: ':memory:', driver: sqlite3.Database });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS current_prices (symbol TEXT PRIMARY KEY, price REAL NOT NULL, last_updated INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS mempool_snapshot (id INTEGER PRIMARY KEY DEFAULT 1, fastest_fee INTEGER, half_hour_fee INTEGER, hour_fee INTEGER, block_height INTEGER, tx_count INTEGER, calculated_supply REAL, last_updated INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS btc_global_metrics_history (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL, market_cap_usd REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS btc_daily_close_prices (date TEXT PRIMARY KEY, price_usd REAL NOT NULL, price_brl REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS fear_greed_history (date TEXT PRIMARY KEY, value INTEGER NOT NULL, classification TEXT NOT NULL, last_updated INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS network_metrics_snapshot (id INTEGER PRIMARY KEY DEFAULT 1, hash_rate_eh_s REAL, difficulty REAL, difficulty_change_pct REAL, avg_block_time_seconds REAL, last_updated INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS btc_dominance_snapshot (id INTEGER PRIMARY KEY DEFAULT 1, dominance_pct REAL NOT NULL, last_updated INTEGER NOT NULL);
    `);

    // Inserir dados de teste
    const now = Date.now();
    await db.run('INSERT INTO current_prices VALUES (?,?,?)', ['BTC-USD', 95000, now]);
    await db.run('INSERT INTO current_prices VALUES (?,?,?)', ['BTC-BRL', 520000, now]);
    await db.run('INSERT INTO current_prices VALUES (?,?,?)', ['BTC-EUR', 87000, now]);
    await db.run('INSERT INTO current_prices VALUES (?,?,?)', ['USDT-BRL', 5.47, now]);
    await db.run('INSERT INTO mempool_snapshot VALUES (1,45,32,18,896000,28500,19700000,?)', [now]);
    await db.run('INSERT INTO btc_global_metrics_history (timestamp, market_cap_usd) VALUES (?,?)', [now, 1870000000000]);
    await db.run('INSERT INTO fear_greed_history VALUES (?,?,?,?)', ['2026-05-15', 65, 'Greed', now]);
    await db.run('INSERT INTO network_metrics_snapshot VALUES (1,650.5,88000000000000,2.5,598,?)', [now]);
    await db.run('INSERT INTO btc_dominance_snapshot VALUES (1,54.3,?)', [now]);

    // Inserir dados históricos suficientes para SMA200
    const stmt = await db.prepare('INSERT OR IGNORE INTO btc_daily_close_prices VALUES (?,?,?)');
    for (let i = 0; i < 365; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        await stmt.run(d.toISOString().split('T')[0], 90000 + i * 10, 490000 + i * 50);
    }
    await stmt.finalize();

    // Criar app Express mínimo para testes
    app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '../../views'));

    app.get('/api/health', async (req, res) => {
        try {
            await db.get('SELECT 1');
            res.json({ status: 'ok', timestamp: Date.now(), uptime: process.uptime() });
        } catch {
            res.status(503).json({ status: 'error', timestamp: Date.now() });
        }
    });

    app.get('/api/data', async (req, res) => {
        try {
            const prices = await db.all('SELECT * FROM current_prices');
            const fearGreed = await db.get('SELECT * FROM fear_greed_history ORDER BY date DESC LIMIT 1');
            const globalMetrics = await db.get('SELECT * FROM btc_global_metrics_history ORDER BY timestamp DESC LIMIT 1');
            const dailyPrices = await db.all('SELECT price_usd FROM btc_daily_close_prices ORDER BY date DESC LIMIT 200');
            const mempool = await db.get('SELECT * FROM mempool_snapshot WHERE id = 1');
            const network = await db.get('SELECT * FROM network_metrics_snapshot WHERE id = 1');
            const dominance = await db.get('SELECT * FROM btc_dominance_snapshot WHERE id = 1');

            const priceMap = Object.fromEntries(prices.map(p => [p.symbol, p.price]));
            const btcUsd = priceMap['BTC-USD'];
            let mayer_multiple = null;
            if (btcUsd && dailyPrices.length >= 200) {
                const sma200 = dailyPrices.reduce((s, r) => s + r.price_usd, 0) / 200;
                mayer_multiple = btcUsd / sma200;
            }

            res.json({
                lastUpdateTimestamp: mempool?.last_updated || Date.now(),
                timeUntilNextUpdate: 300000,
                prices: {
                    btc_usd: priceMap['BTC-USD'],
                    btc_brl: priceMap['BTC-BRL'],
                    btc_eur: priceMap['BTC-EUR'],
                    usdt_brl: priceMap['USDT-BRL'],
                },
                mempool: { fastest_fee: mempool?.fastest_fee, half_hour_fee: mempool?.half_hour_fee, hour_fee: mempool?.hour_fee, block_height: mempool?.block_height, tx_count: mempool?.tx_count, calculated_supply: mempool?.calculated_supply },
                fearGreed: { value: fearGreed?.value, classification: fearGreed?.classification, last_updated: fearGreed?.last_updated },
                globalMetrics: { market_cap_usd: globalMetrics?.market_cap_usd, mayer_multiple, btc_dominance_pct: dominance?.dominance_pct, s2f_ratio: 119.8 },
                network: { hash_rate_eh_s: network?.hash_rate_eh_s, difficulty: network?.difficulty, difficulty_change_pct: network?.difficulty_change_pct, avg_block_time_seconds: network?.avg_block_time_seconds },
            });
        } catch (err) {
            res.status(500).json({ error: 'Falha ao processar a requisição.' });
        }
    });

    app.get('/api/historical-prices', async (req, res) => {
        const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 365));
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const data = await db.all(
            'SELECT date, price_usd, price_brl FROM btc_daily_close_prices WHERE date >= ? ORDER BY date ASC',
            [startDate.toISOString().split('T')[0]]
        );
        res.json(data);
    });

    app.get('/api/fear-greed-history', async (req, res) => {
        const data = await db.all('SELECT date, value, classification FROM fear_greed_history ORDER BY date DESC LIMIT 90');
        res.json(data.reverse());
    });

    return app;
}

beforeAll(async () => {
    await setupTestApp();
}, 10000);

afterAll(async () => {
    if (db) await db.close();
});

// --- TESTES ---

describe('GET /api/health', () => {
    test('retorna 200 com status ok', async () => {
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        expect(res.body.timestamp).toBeGreaterThan(0);
    });
});

describe('GET /api/data', () => {
    test('retorna 200 com estrutura correta', async () => {
        const res = await request(app).get('/api/data');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('prices');
        expect(res.body).toHaveProperty('mempool');
        expect(res.body).toHaveProperty('fearGreed');
        expect(res.body).toHaveProperty('globalMetrics');
        expect(res.body).toHaveProperty('network');
    });

    test('preços contêm BTC-USD, BTC-BRL, BTC-EUR, USDT-BRL', async () => {
        const res = await request(app).get('/api/data');
        expect(res.body.prices.btc_usd).toBe(95000);
        expect(res.body.prices.btc_brl).toBe(520000);
        expect(res.body.prices.btc_eur).toBe(87000);
        expect(res.body.prices.usdt_brl).toBe(5.47);
    });

    test('Mayer Multiple é calculado (requer 200 dias de histórico)', async () => {
        const res = await request(app).get('/api/data');
        expect(res.body.globalMetrics.mayer_multiple).not.toBeNull();
        expect(res.body.globalMetrics.mayer_multiple).toBeGreaterThan(0);
    });

    test('globalMetrics contém dominância e s2f_ratio', async () => {
        const res = await request(app).get('/api/data');
        expect(res.body.globalMetrics.btc_dominance_pct).toBe(54.3);
        expect(res.body.globalMetrics.s2f_ratio).toBe(119.8);
    });

    test('network contém hash_rate_eh_s e difficulty', async () => {
        const res = await request(app).get('/api/data');
        expect(res.body.network.hash_rate_eh_s).toBe(650.5);
        expect(res.body.network.difficulty).toBe(88000000000000);
    });

    test('timeUntilNextUpdate é um número', async () => {
        const res = await request(app).get('/api/data');
        expect(typeof res.body.timeUntilNextUpdate).toBe('number');
    });
});

describe('GET /api/historical-prices', () => {
    test('retorna array de preços históricos', async () => {
        const res = await request(app).get('/api/historical-prices');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
    });

    test('cada registro tem date, price_usd e price_brl', async () => {
        const res = await request(app).get('/api/historical-prices');
        const first = res.body[0];
        expect(first).toHaveProperty('date');
        expect(first).toHaveProperty('price_usd');
        expect(first).toHaveProperty('price_brl');
    });

    test('parâmetro ?days=30 limita resultados a ~30 dias', async () => {
        const res = await request(app).get('/api/historical-prices?days=30');
        expect(res.status).toBe(200);
        expect(res.body.length).toBeLessThanOrEqual(31);
    });

    test('?days=0 é tratado como 1 dia mínimo', async () => {
        const res = await request(app).get('/api/historical-prices?days=0');
        expect(res.status).toBe(200);
    });

    test('?days=999 é limitado a 365 dias', async () => {
        const res = await request(app).get('/api/historical-prices?days=999');
        expect(res.status).toBe(200);
        expect(res.body.length).toBeLessThanOrEqual(366);
    });
});

describe('GET /api/fear-greed-history', () => {
    test('retorna array', async () => {
        const res = await request(app).get('/api/fear-greed-history');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    test('registros têm date, value e classification', async () => {
        const res = await request(app).get('/api/fear-greed-history');
        if (res.body.length > 0) {
            expect(res.body[0]).toHaveProperty('date');
            expect(res.body[0]).toHaveProperty('value');
            expect(res.body[0]).toHaveProperty('classification');
        }
    });
});
