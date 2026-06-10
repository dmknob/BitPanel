// =============================================================================
// BitPanel — server.ts
// Banco de dados: better-sqlite3 (síncrono, sem wrapper `sqlite`).
// NÃO utilizar os pacotes `sqlite3` nem `sqlite` — incompatíveis com o
// ambiente de produção por exigirem GLIBC_2.38+ (ver ADR: db-driver.md).
// =============================================================================

// 1. Imports
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const axios = require('axios');
const cors = require('cors');
const cron = require('node-cron');
// Driver SQLite: better-sqlite3 (API síncrona, sem wrapper `sqlite`)
const Database = require('better-sqlite3');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

import type { Request, Response, NextFunction } from 'express';

// --- TIPOS ---

interface PriceRow {
    symbol: string;
    price: number;
    last_updated: number;
}

interface MempoolRow {
    fastest_fee: number;
    half_hour_fee: number;
    hour_fee: number;
    block_height: number;
    tx_count: number;
    calculated_supply: number;
    last_updated: number;
}

interface NetworkMetricsRow {
    hash_rate_eh_s: number;
    difficulty: number;
    difficulty_change_pct: number;
    avg_block_time_seconds: number;
    last_updated: number;
}

interface DominanceRow {
    dominance_pct: number;
    last_updated: number;
}

interface FearGreedRow {
    date: string;
    value: number;
    classification: string;
    last_updated: number;
}

interface DailyPriceRow {
    price_usd: number;
}

interface LightningRow {
    capacity_btc: number | null;
    channels: number | null;
    nodes: number | null;
    last_updated: number;
}

interface GlobalMetricsRow {
    timestamp: number;
    market_cap_usd: number;
}

interface PriceAlertRow {
    id: number;
    currency: string;
    direction: string;
    threshold: number;
    endpoint: string;
    p256dh: string;
    auth: string;
}

interface ApiDataPayload {
    lastUpdateTimestamp: number;
    timeUntilNextUpdate: number;
    prices: {
        btc_usd: number | undefined;
        btc_brl: number | undefined;
        btc_eur: number | undefined;
        usdt_brl: number | undefined;
    };
    mempool: {
        fastest_fee: number | undefined;
        half_hour_fee: number | undefined;
        hour_fee: number | undefined;
        block_height: number | undefined;
        tx_count: number | undefined;
        calculated_supply: number | undefined;
    };
    fearGreed: {
        value: number | undefined;
        classification: string | undefined;
        last_updated: number | undefined;
    };
    globalMetrics: {
        market_cap_usd: number | null | undefined;
        mayer_multiple: number | null;
        btc_dominance_pct: number | null;
        s2f_ratio: number | null;
    };
    network: {
        hash_rate_eh_s: number | null;
        difficulty: number | null;
        difficulty_change_pct: number | null;
        avg_block_time_seconds: number | null;
        last_updated: number | null;
    };
    lightning: {
        capacity_btc: number | null;
        channels: number | null;
        nodes: number | null;
        last_updated: number | null;
    };
}

// web-push (opcional — ativo somente se VAPID_PUBLIC_KEY estiver definido no .env)
let webpush: any = null;
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush = require('web-push');
    webpush.setVapidDetails(
        `mailto:${process.env.VAPID_CONTACT_EMAIL || 'admin@bitpanel.local'}`,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

// Sentry (opcional — ativo somente se SENTRY_DSN estiver definido no .env)
let Sentry: any = null;
if (process.env.SENTRY_DSN) {
    Sentry = require('@sentry/node');
    Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });
}

// --- VARIÁVEIS GLOBAIS ---
let db: any;
let initialDataLoadPromise: Promise<any> | null = null;
let wsClients: Set<any> = new Set();
let wss: any = null;

// --- CONFIGURAÇÃO DE INTERVALO ---
const UPDATE_INTERVAL_SECONDS: number = parseInt(process.env.UPDATE_INTERVAL_SECONDS || '600') || 600;
const UPDATE_INTERVAL_MS: number = UPDATE_INTERVAL_SECONDS * 1000;
const cronIntervalMinutes: number = Math.max(1, Math.round(UPDATE_INTERVAL_SECONDS / 60));
const CRON_SCHEDULE_HIGH_FREQUENCY: string = `*/${cronIntervalMinutes} * * * *`;

// --- VALIDAÇÃO DE VARIÁVEIS DE AMBIENTE ---
function validateEnv(): void {
    const required = ['COINGECKO_API_KEY'];
    const missing = required.filter(k => !process.env[k] || process.env[k] === 'SUA_API_KEY_AQUI');
    if (missing.length) {
        console.error(`ERRO CRÍTICO: Variáveis de ambiente obrigatórias não definidas ou com valor padrão: ${missing.join(', ')}`);
        process.exit(1);
    }
}

// --- CLIENTE HTTP COM TIMEOUT ---
const httpClient = axios.create({ timeout: 10_000 });

const COINGECKO_HEADERS = (): Record<string, string> => ({ 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY as string });

async function fetchWithRetry(url: string, options: object = {}, retries: number = 3): Promise<any> {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            return await httpClient.get(url, options);
        } catch (err: any) {
            if (attempt === retries - 1) throw err;
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
    }
}

// --- BANCO DE DADOS + MIGRATIONS ---
// Utiliza better-sqlite3 (API 100% síncrona).
// Referência: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md

function initializeDatabase(): void {
    try {
        const dbPath = path.join(__dirname, process.env.DB_NAME || 'bitpanel.sqlite');
        // WAL mode melhora concorrência de leitura sem overhead de locks
        db = new Database(dbPath, { verbose: process.env.NODE_ENV === 'development' ? console.log : undefined });
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        runMigrations(db);
        console.log("Banco de dados SQLite conectado e atualizado.");
    } catch (error) {
        console.error("Erro ao inicializar o banco de dados SQLite:", error);
        process.exit(1);
    }
}

function runMigrations(db: any): void {
    // better-sqlite3: db.pragma retorna o valor direto com { simple: true }
    const version: number = db.pragma('user_version', { simple: true });

    if (version < 1) {
        db.exec(`
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
        db.pragma('user_version = 1');
        console.log("Migration 1: Schema inicial criado.");
    }

    if (version < 2) {
        db.exec(`
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
        db.pragma('user_version = 2');
        console.log("Migration 2: Tabelas de rede e dominância criadas.");
    }

    if (version < 3) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                endpoint TEXT UNIQUE NOT NULL,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS price_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subscription_id INTEGER NOT NULL,
                currency TEXT NOT NULL DEFAULT 'BRL',
                direction TEXT NOT NULL,
                threshold REAL NOT NULL,
                created_at INTEGER NOT NULL,
                triggered_at INTEGER,
                active INTEGER NOT NULL DEFAULT 1,
                FOREIGN KEY (subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE
            );
        `);
        db.pragma('user_version = 3');
        console.log("Migration 3: Tabelas de push notifications e alertas criadas.");
    }

    if (version < 4) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS lightning_snapshot (
                id INTEGER PRIMARY KEY DEFAULT 1,
                capacity_btc REAL,
                channels INTEGER,
                nodes INTEGER,
                last_updated INTEGER NOT NULL
            );
        `);
        db.pragma('user_version = 4');
        console.log("Migration 4: Tabela de Lightning Network criada.");
    }
}

// --- FUNÇÕES PURAS DE CÁLCULO ---

function calculateBitcoinSupply(blockHeight: number): number {
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

function calculateStockToFlow(supply: number, blockHeight: number): number | null {
    const halvingInterval = 210_000;
    const epoch = Math.floor(blockHeight / halvingInterval);
    const blockReward = 50 / Math.pow(2, epoch);
    // ~6 blocos/hora * 24h * 365 dias = 52.560 blocos/ano
    const annualFlow = blockReward * 52_560;
    if (annualFlow <= 0) return null;
    return supply / annualFlow;
}

// --- WORKERS ---

async function updateHighFrequencyData(): Promise<void> {
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
        const btcUsd: number = p?.bitcoin?.usd;
        const btcBrl: number = p?.bitcoin?.brl;
        const btcEur: number | null = p?.bitcoin?.eur ?? null;
        const usdtBrl: number = p?.tether?.brl;

        if (typeof btcUsd !== 'number' || typeof btcBrl !== 'number') {
            throw new Error(`Resposta CoinGecko incompleta: ${JSON.stringify(p)}`);
        }

        const upsertPrice = db.prepare('INSERT OR REPLACE INTO current_prices (symbol, price, last_updated) VALUES (?,?,?)');
        upsertPrice.run('BTC-USD', btcUsd, now);
        upsertPrice.run('BTC-BRL', btcBrl, now);
        upsertPrice.run('BTC-EUR', btcEur, now);
        upsertPrice.run('USDT-BRL', usdtBrl, now);

        const blockHeight: number = heightRes.data;
        const supply: number = calculateBitcoinSupply(blockHeight);
        const marketCap: number = btcUsd * supply;

        db.prepare(
            `INSERT OR REPLACE INTO mempool_snapshot (id, fastest_fee, half_hour_fee, hour_fee, block_height, tx_count, calculated_supply, last_updated) VALUES (1,?,?,?,?,?,?,?)`
        ).run(feesRes.data.fastestFee, feesRes.data.halfHourFee, feesRes.data.hourFee, blockHeight, mempoolRes.data.count, supply, now);

        db.prepare('INSERT INTO btc_global_metrics_history (timestamp, market_cap_usd) VALUES (?,?)').run(now, marketCap);

        await checkAndSendAlerts({ btc_usd: btcUsd, btc_brl: btcBrl });
        console.log(`[${ts}] Worker: Dados de alta frequência salvos com sucesso.`);
        broadcastUpdate().catch(() => { });
    } catch (err: any) {
        console.error(`[${ts}] Worker: ERRO ao buscar dados de alta frequência:`, err.message);
        if (Sentry) Sentry.captureException(err);
    }
}

async function updateNetworkMetrics(): Promise<void> {
    const ts = new Date().toLocaleString('pt-BR');
    console.log(`[${ts}] Worker: Buscando métricas de rede Bitcoin...`);
    try {
        const res = await fetchWithRetry('https://mempool.space/api/v1/difficulty-adjustment');
        const d = res.data;
        const timeAvgSeconds: number = (d.timeAvg || 600_000) / 1000;
        const difficulty: number = d.currentDifficulty;
        // Hash rate em EH/s: (difficulty * 2^32) / timeAvgSegundos / 1e18
        const hashRateEHs: number = (difficulty * Math.pow(2, 32)) / (timeAvgSeconds * 1e18);
        const difficultyChangePct: number | null = d.difficultyChange ?? null;

        db.prepare(
            `INSERT OR REPLACE INTO network_metrics_snapshot (id, hash_rate_eh_s, difficulty, difficulty_change_pct, avg_block_time_seconds, last_updated) VALUES (1,?,?,?,?,?)`
        ).run(hashRateEHs, difficulty, difficultyChangePct, timeAvgSeconds, Date.now());

        console.log(`[${ts}] Worker: Métricas de rede salvas. Hash rate: ${hashRateEHs.toFixed(2)} EH/s`);
    } catch (err: any) {
        console.error(`[${ts}] Worker: ERRO ao buscar métricas de rede:`, err.message);
        if (Sentry) Sentry.captureException(err);
    }
}

async function updateDominanceData(): Promise<void> {
    const ts = new Date().toLocaleString('pt-BR');
    console.log(`[${ts}] Worker: Buscando dominância do Bitcoin...`);
    try {
        const res = await fetchWithRetry('https://api.coingecko.com/api/v3/global', { headers: COINGECKO_HEADERS() });
        const dominancePct: number = res.data?.data?.market_cap_percentage?.btc;
        if (typeof dominancePct !== 'number') throw new Error('Dominância não retornada pela API');

        db.prepare(
            `INSERT OR REPLACE INTO btc_dominance_snapshot (id, dominance_pct, last_updated) VALUES (1,?,?)`
        ).run(dominancePct, Date.now());

        console.log(`[${ts}] Worker: Dominância BTC: ${dominancePct.toFixed(2)}%`);
    } catch (err: any) {
        console.error(`[${ts}] Worker: ERRO ao buscar dominância:`, err.message);
        if (Sentry) Sentry.captureException(err);
    }
}

async function updateFearGreedData(): Promise<void> {
    const ts = new Date().toLocaleString('pt-BR');
    try {
        console.log(`[${ts}] Worker: Buscando Fear & Greed Index...`);
        const res = await fetchWithRetry('https://api.alternative.me/fng/?limit=1&format=json');
        const fng = res.data.data[0];
        const today = new Date().toISOString().split('T')[0];
        db.prepare(
            'INSERT OR REPLACE INTO fear_greed_history (date, value, classification, last_updated) VALUES (?,?,?,?)'
        ).run(today, fng.value, fng.value_classification, Date.now());
        console.log(`[${ts}] Worker: Fear & Greed Index salvo para ${today}.`);
    } catch (err: any) {
        console.error(`[${ts}] Worker: ERRO ao buscar Fear & Greed:`, err.message);
        if (Sentry) Sentry.captureException(err);
    }
}

async function updateLightningData(): Promise<void> {
    const ts = new Date().toLocaleString('pt-BR');
    console.log(`[${ts}] Worker: Buscando métricas da Lightning Network...`);
    try {
        const res = await fetchWithRetry('https://mempool.space/api/v1/lightning/statistics/latest');
        const d = res.data;
        const capacityBtc: number | null = d.latest?.total_capacity != null ? d.latest.total_capacity / 1e8 : null;
        const channels: number | null = d.latest?.channel_count ?? null;
        const nodes: number | null = d.latest?.node_count ?? null;

        db.prepare(
            `INSERT OR REPLACE INTO lightning_snapshot (id, capacity_btc, channels, nodes, last_updated) VALUES (1,?,?,?,?)`
        ).run(capacityBtc, channels, nodes, Date.now());

        console.log(`[${ts}] Worker: Lightning Network — ${capacityBtc?.toFixed(0)} BTC em ${channels?.toLocaleString()} canais.`);
    } catch (err: any) {
        console.error(`[${ts}] Worker: ERRO ao buscar dados da Lightning Network:`, err.message);
        if (Sentry) Sentry.captureException(err);
    }
}

async function syncHistoricDataOnStartup(): Promise<void> {
    const ts = new Date().toLocaleString('pt-BR');
    console.log(`[${ts}] Worker (Inicialização): Sincronizando histórico de preços (USD & BRL)...`);
    try {
        const [usdRes, brlRes] = await Promise.all([
            fetchWithRetry('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365&interval=daily', { headers: COINGECKO_HEADERS() }),
            fetchWithRetry('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=brl&days=365&interval=daily', { headers: COINGECKO_HEADERS() }),
        ]);

        const usdPrices: [number, number][] = usdRes.data.prices;
        const brlPrices: [number, number][] = brlRes.data.prices;

        if (!usdPrices?.length || !brlPrices?.length) {
            throw new Error("Histórico vazio retornado pela CoinGecko.");
        }

        const combined = new Map<string, { date: string; price_usd?: number; price_brl?: number }>();
        for (const [timestamp, price] of usdPrices) {
            const date = new Date(timestamp).toISOString().split('T')[0];
            combined.set(date, { date, price_usd: price });
        }
        for (const [timestamp, price] of brlPrices) {
            const date = new Date(timestamp).toISOString().split('T')[0];
            if (combined.has(date)) combined.get(date)!.price_brl = price;
        }

        // better-sqlite3: prepare uma vez, execute em transação para performance
        const stmt = db.prepare('INSERT OR IGNORE INTO btc_daily_close_prices (date, price_usd, price_brl) VALUES (?,?,?)');
        const insertMany = db.transaction((rows: { date: string; price_usd: number; price_brl: number }[]) => {
            let inserted = 0;
            for (const row of rows) {
                const result = stmt.run(row.date, row.price_usd, row.price_brl);
                if (result.changes > 0) inserted++;
            }
            return inserted;
        });

        const validRows = [...combined.values()].filter(r => r.price_usd && r.price_brl) as { date: string; price_usd: number; price_brl: number }[];
        const inserted = insertMany(validRows);
        console.log(`[${ts}] Worker (Inicialização): ${inserted} novos registros históricos adicionados.`);
    } catch (err: any) {
        console.error(`[${ts}] Worker (Inicialização): ERRO ao sincronizar histórico:`, err.message);
        if (Sentry) Sentry.captureException(err);
    }
}

async function updateLatestDailyData(): Promise<void> {
    const ts = new Date().toLocaleString('pt-BR');
    console.log(`[${ts}] Worker (Diário): Buscando fechamento de ontem...`);
    try {
        const [usdRes, brlRes] = await Promise.all([
            fetchWithRetry('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=2&interval=daily', { headers: COINGECKO_HEADERS() }),
            fetchWithRetry('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=brl&days=2&interval=daily', { headers: COINGECKO_HEADERS() }),
        ]);

        const usdPrices: [number, number][] = usdRes.data.prices;
        const brlPrices: [number, number][] = brlRes.data.prices;
        if (usdPrices?.length > 1 && brlPrices?.length > 1) {
            const yesterday = usdPrices[usdPrices.length - 2];
            const date = new Date(yesterday[0]).toISOString().split('T')[0];
            const priceUsd = yesterday[1];
            const priceBrl = brlPrices[brlPrices.length - 2][1];
            const result = db.prepare('INSERT OR IGNORE INTO btc_daily_close_prices (date, price_usd, price_brl) VALUES (?,?,?)').run(date, priceUsd, priceBrl);
            if (result.changes > 0) {
                console.log(`[${ts}] Worker (Diário): Novo fechamento adicionado para ${date}.`);
            } else {
                console.log(`[${ts}] Worker (Diário): Preço para ${date} já atualizado.`);
            }
        }
    } catch (err: any) {
        console.error(`[${ts}] Worker (Diário): ERRO ao buscar fechamento diário:`, err.message);
        if (Sentry) Sentry.captureException(err);
    }
}

// --- ALERTAS DE PREÇO VIA PUSH ---

async function checkAndSendAlerts(prices: { btc_usd: number; btc_brl: number }): Promise<void> {
    if (!webpush) return;
    try {
        const alerts: PriceAlertRow[] = db.prepare(`
            SELECT a.id, a.currency, a.direction, a.threshold, s.endpoint, s.p256dh, s.auth
            FROM price_alerts a
            JOIN push_subscriptions s ON a.subscription_id = s.id
            WHERE a.active = 1
        `).all();

        for (const alert of alerts) {
            const current = alert.currency === 'USD' ? prices.btc_usd : prices.btc_brl;
            if (current == null) continue;

            const triggered =
                (alert.direction === 'above' && current >= alert.threshold) ||
                (alert.direction === 'below' && current <= alert.threshold);

            if (!triggered) continue;

            const sym = alert.currency === 'USD' ? '$' : 'R$';
            const dir = alert.direction === 'above' ? 'acima de' : 'abaixo de';
            const payload = JSON.stringify({
                title: '🚨 Alerta BitPanel',
                body: `BTC/${alert.currency} ${dir} ${sym}${alert.threshold.toLocaleString('pt-BR')} · Atual: ${sym}${current.toLocaleString('pt-BR')}`,
                icon: '/images/icon-192x192.png',
                badge: '/images/icon-192x192.png',
                url: '/',
            });

            try {
                await webpush.sendNotification(
                    { endpoint: alert.endpoint, keys: { p256dh: alert.p256dh, auth: alert.auth } },
                    payload
                );
                db.prepare('UPDATE price_alerts SET active = 0, triggered_at = ? WHERE id = ?').run(Date.now(), alert.id);
                console.log(`Alerta ${alert.id} disparado (${alert.currency} ${alert.direction} ${alert.threshold}).`);
            } catch (err: any) {
                if (err.statusCode === 410) {
                    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(alert.endpoint);
                    console.log(`Subscription expirada removida: ${alert.endpoint}`);
                } else {
                    console.error(`Erro ao enviar push alerta ${alert.id}:`, err.message);
                }
            }
        }
    } catch (err: any) {
        console.error("Erro ao verificar alertas de preço:", err.message);
        if (Sentry) Sentry.captureException(err);
    }
}

// --- PAYLOAD DE DADOS E WEBSOCKET ---

async function buildDataPayload(): Promise<ApiDataPayload> {
    const mempool: MempoolRow | undefined = db.prepare('SELECT * FROM mempool_snapshot WHERE id = 1').get();
    if (!mempool) await initialDataLoadPromise;

    const prices: PriceRow[] = db.prepare('SELECT * FROM current_prices').all();
    const fearGreed: FearGreedRow | undefined = db.prepare('SELECT * FROM fear_greed_history ORDER BY date DESC LIMIT 1').get();
    const globalMetrics: GlobalMetricsRow | undefined = db.prepare('SELECT * FROM btc_global_metrics_history ORDER BY timestamp DESC LIMIT 1').get();
    const dailyPrices: DailyPriceRow[] = db.prepare('SELECT price_usd FROM btc_daily_close_prices ORDER BY date DESC LIMIT 200').all();
    const freshMempool: MempoolRow | undefined = db.prepare('SELECT * FROM mempool_snapshot WHERE id = 1').get();

    let networkMetrics: NetworkMetricsRow | undefined;
    let dominance: DominanceRow | undefined;
    let lightning: LightningRow | undefined;
    try { networkMetrics = db.prepare('SELECT * FROM network_metrics_snapshot WHERE id = 1').get(); } catch { }
    try { dominance = db.prepare('SELECT * FROM btc_dominance_snapshot WHERE id = 1').get(); } catch { }
    try { lightning = db.prepare('SELECT * FROM lightning_snapshot WHERE id = 1').get(); } catch { }

    const priceMap: Record<string, number> = Object.fromEntries((prices || []).map((p: PriceRow) => [p.symbol, p.price]));
    const currentBtcUsd = priceMap['BTC-USD'];

    let mayer_multiple: number | null = null;
    if (currentBtcUsd && dailyPrices?.length >= 200) {
        const sma200 = dailyPrices.reduce((s: number, r: DailyPriceRow) => s + r.price_usd, 0) / 200;
        mayer_multiple = currentBtcUsd / sma200;
    }

    const supply = freshMempool?.calculated_supply;
    const blockHeight = freshMempool?.block_height;
    const s2f_ratio = (supply && blockHeight != null) ? calculateStockToFlow(supply, blockHeight) : null;

    const lastUpdateTimestamp = freshMempool?.last_updated || Date.now();
    const timeUntilNextUpdate = (lastUpdateTimestamp + UPDATE_INTERVAL_MS) - Date.now();

    return {
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
        lightning: {
            capacity_btc: lightning?.capacity_btc ?? null,
            channels: lightning?.channels ?? null,
            nodes: lightning?.nodes ?? null,
            last_updated: lightning?.last_updated ?? null,
        },
    };
}

async function broadcastUpdate(): Promise<void> {
    if (!wss || wsClients.size === 0) return;
    try {
        const payload = await buildDataPayload();
        const message = JSON.stringify({ type: 'update', data: payload });
        for (const client of wsClients) {
            if (client.readyState === 1) { // WebSocket.OPEN = 1
                client.send(message);
            }
        }
    } catch (err: any) {
        console.error("Erro ao fazer broadcast WebSocket:", err.message);
    }
}

// --- AGENDADORES ---

function scheduleHighFrequencyWorker(): void {
    console.log(`Agendando worker de alta frequência a cada ${cronIntervalMinutes} minutos.`);
    cron.schedule(CRON_SCHEDULE_HIGH_FREQUENCY, () => {
        updateHighFrequencyData();
        updateNetworkMetrics();
        updateDominanceData();
    });
}

function scheduleDailyWorker(): void {
    cron.schedule('15 0 * * *', () => {
        const ts = new Date().toLocaleString('pt-BR');
        console.log(`[${ts}] SCHEDULE: Disparando workers diários...`);
        updateFearGreedData();
        updateLatestDailyData();
        updateLightningData();
    });
}

// --- SERVIDOR EXPRESS ---

const app = express();
const PORT: number = parseInt(process.env.PORT || '3000') || 3000;

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
            connectSrc: ["'self'", "https://www.google-analytics.com", "https://region1.google-analytics.com", "wss:", "ws:"],
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

// Body parser para endpoints JSON
app.use(express.json());

// Arquivos estáticos e template engine
app.use(express.static(path.join(__dirname, 'static')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- ENDPOINTS DE API ---

app.get('/api/health', (req: Request, res: Response) => {
    try {
        db.prepare('SELECT 1').get();
        res.json({ status: 'ok', timestamp: Date.now(), uptime: process.uptime() });
    } catch {
        res.status(503).json({ status: 'error', timestamp: Date.now() });
    }
});

app.get('/api/data', async (req: Request, res: Response) => {
    const ts = new Date().toLocaleString('pt-BR');
    console.log(`[${ts}] API /api/data: requisição recebida.`);
    try {
        const payload = await buildDataPayload();
        res.json(payload);
    } catch (err: any) {
        console.error("Erro no endpoint /api/data:", err);
        if (Sentry) Sentry.captureException(err);
        res.status(500).json({ error: "Falha ao processar a requisição." });
    }
});

app.get('/api/historical-prices', (req: Request, res: Response) => {
    const ts = new Date().toLocaleString('pt-BR');
    const days = Math.min(365, Math.max(1, parseInt(req.query.days as string) || 365));
    console.log(`[${ts}] API /api/historical-prices: ${days} dias.`);
    try {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = startDate.toISOString().split('T')[0];
        const data = db.prepare(
            'SELECT date, price_usd, price_brl FROM btc_daily_close_prices WHERE date >= ? ORDER BY date ASC'
        ).all(startDateStr);
        res.json(data);
    } catch (err: any) {
        console.error("Erro ao buscar histórico:", err);
        if (Sentry) Sentry.captureException(err);
        res.status(500).json({ error: "Falha ao buscar dados históricos." });
    }
});

app.get('/api/fear-greed-history', (req: Request, res: Response) => {
    try {
        const data: any[] = db.prepare(
            'SELECT date, value, classification FROM fear_greed_history ORDER BY date DESC LIMIT 90'
        ).all();
        res.json(data.reverse());
    } catch (err: any) {
        console.error("Erro ao buscar histórico Fear & Greed:", err);
        if (Sentry) Sentry.captureException(err);
        res.status(500).json({ error: "Falha ao buscar histórico do Fear & Greed." });
    }
});

// --- ENDPOINTS DE PUSH NOTIFICATIONS E ALERTAS ---

app.get('/api/push/vapid-public-key', (req: Request, res: Response) => {
    if (!process.env.VAPID_PUBLIC_KEY) {
        return res.status(503).json({ error: 'Push notifications não configuradas no servidor.' });
    }
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

app.post('/api/push/subscribe', (req: Request, res: Response) => {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return res.status(400).json({ error: 'Subscription inválida: endpoint e keys (p256dh, auth) são obrigatórios.' });
    }
    try {
        db.prepare(
            'INSERT OR REPLACE INTO push_subscriptions (endpoint, p256dh, auth, created_at) VALUES (?,?,?,?)'
        ).run(endpoint, keys.p256dh, keys.auth, Date.now());
        const sub = db.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').get(endpoint);
        res.json({ subscriptionId: sub.id });
    } catch (err: any) {
        console.error("Erro ao salvar subscription:", err.message);
        res.status(500).json({ error: 'Erro ao salvar subscription.' });
    }
});

app.delete('/api/push/subscribe', (req: Request, res: Response) => {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: 'endpoint é obrigatório.' });
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
    res.json({ ok: true });
});

app.post('/api/alerts', (req: Request, res: Response) => {
    const { endpoint, currency, direction, threshold } = req.body || {};
    if (!endpoint || !currency || !direction || threshold == null) {
        return res.status(400).json({ error: 'Campos obrigatórios: endpoint, currency, direction, threshold.' });
    }
    if (!['BRL', 'USD'].includes(currency)) {
        return res.status(400).json({ error: 'currency deve ser BRL ou USD.' });
    }
    if (!['above', 'below'].includes(direction)) {
        return res.status(400).json({ error: 'direction deve ser above ou below.' });
    }
    const thresh = parseFloat(threshold);
    if (isNaN(thresh) || thresh <= 0) {
        return res.status(400).json({ error: 'threshold deve ser um número positivo.' });
    }
    try {
        const sub = db.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').get(endpoint);
        if (!sub) return res.status(404).json({ error: 'Subscription não encontrada. Ative as notificações primeiro.' });
        const result = db.prepare(
            'INSERT INTO price_alerts (subscription_id, currency, direction, threshold, created_at) VALUES (?,?,?,?,?)'
        ).run(sub.id, currency, direction, thresh, Date.now());
        res.json({ id: result.lastInsertRowid });
    } catch (err: any) {
        console.error("Erro ao criar alerta:", err.message);
        res.status(500).json({ error: 'Erro ao criar alerta.' });
    }
});

app.get('/api/alerts', (req: Request, res: Response) => {
    const { endpoint } = req.query;
    if (!endpoint) return res.status(400).json({ error: 'Parâmetro endpoint obrigatório.' });
    try {
        const sub = db.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').get(endpoint);
        if (!sub) return res.json([]);
        const alerts = db.prepare(
            'SELECT id, currency, direction, threshold, created_at, triggered_at, active FROM price_alerts WHERE subscription_id = ? ORDER BY created_at DESC'
        ).all(sub.id);
        res.json(alerts);
    } catch (err: any) {
        res.status(500).json({ error: 'Erro ao listar alertas.' });
    }
});

app.delete('/api/alerts/:id', (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    db.prepare('DELETE FROM price_alerts WHERE id = ?').run(id);
    res.json({ ok: true });
});

// --- ROTAS DE PÁGINAS ---

app.get('/', (req: Request, res: Response) => {
    res.render('pages/index', {
        page: 'dashboard',
        title: 'BitPanel | Preço Bitcoin, Indicadores e Cotação em Tempo Real',
        description: 'Acompanhe o preço do Bitcoin (BTC) em tempo real, indicadores on-chain como o Múltiplo de Mayer, o Índice de Medo e Ganância (Fear & Greed) e as taxas da rede. Seu painel completo para a cotação do BTC.',
    });
});

app.get('/dca', (req: Request, res: Response) => {
    res.render('pages/dca', {
        page: 'dca',
        title: 'Calculadora DCA de Bitcoin | Simule Dollar Cost Averaging',
        description: 'Use a calculadora de DCA (Dollar Cost Averaging) para simular o resultado de aportes recorrentes em Bitcoin (BTC), em Reais (BRL) ou Dólares (USD). Descubra o melhor dia da semana ou do mês para comprar Bitcoin.',
    });
});

app.get('/tv', (req: Request, res: Response) => {
    res.render('pages/tv', {
        page: 'tv',
        title: 'BitPanel TV | Bitcoin em Tela Cheia',
        description: 'Dashboard Bitcoin para exibição em TV ou monitor.',
    });
});

// --- HANDLERS DE ERRO ---

// Sentry error handler (antes dos handlers 404/500)
if (Sentry) app.use(Sentry.Handlers.errorHandler());

// 404
app.use((req: Request, res: Response) => {
    res.status(404).render('pages/404', {
        page: 'error',
        title: 'Página não encontrada | BitPanel',
        description: '',
    });
});

// 500
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error("Erro interno:", err);
    res.status(500).render('pages/500', {
        page: 'error',
        title: 'Erro interno | BitPanel',
        description: '',
    });
});

// --- INICIALIZAÇÃO ---

async function startServer(): Promise<void> {
    validateEnv();
    initializeDatabase(); // síncrono com better-sqlite3
    const server = http.createServer(app);
    wss = new WebSocketServer({ server });
    wss.on('connection', (ws: any) => {
        wsClients.add(ws);
        ws.on('close', () => wsClients.delete(ws));
        ws.on('error', () => wsClients.delete(ws));
    });
    server.listen(PORT, () => {
        console.log(`Servidor rodando em http://localhost:${PORT}`);
        scheduleHighFrequencyWorker();
        scheduleDailyWorker();
        console.log("Workers agendados. Disparando carga inicial de dados...");
        initialDataLoadPromise = Promise.all([
            updateFearGreedData(),
            updateHighFrequencyData(),
            updateNetworkMetrics(),
            updateDominanceData(),
            updateLightningData(),
            syncHistoricDataOnStartup(),
        ]);
    });
}

startServer();
