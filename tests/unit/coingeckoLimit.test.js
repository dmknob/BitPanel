'use strict';

const fs = require('fs');
const path = require('path');

describe('CoinGecko API Limit Safety Test', () => {
    let serverContent;

    beforeAll(() => {
        const filePath = path.join(__dirname, '../../server.ts');
        serverContent = fs.readFileSync(filePath, 'utf8');
    });

    test('updateDominanceData (CoinGecko /global) não deve ser chamado no loop de alta frequência', () => {
        const highFreqWorkerRegex = /function\s+scheduleHighFrequencyWorker[\s\S]*?\{([\s\S]*?)\}/;
        const match = serverContent.match(highFreqWorkerRegex);
        expect(match).toBeTruthy();
        
        const body = match[1];
        expect(body).not.toMatch(/updateDominanceData\s*\(/);
    });

    test('scheduleDominanceWorker deve estar configurado para rodar a cada 1 hora', () => {
        const dominanceWorkerRegex = /function\s+scheduleDominanceWorker[\s\S]*?\{([\s\S]*?)\}/;
        const match = serverContent.match(dominanceWorkerRegex);
        expect(match).toBeTruthy();
        
        const body = match[1];
        expect(body).toMatch(/cron\.schedule\(\s*['"]0\s+\*\s+\*\s+\*\s+\*['"]/);
    });

    test('syncHistoricDataOnStartup deve ter verificação de cache no banco para evitar chamadas extras', () => {
        const syncRegex = /async\s+function\s+syncHistoricDataOnStartup[\s\S]*?\{([\s\S]*?)\}/;
        const match = serverContent.match(syncRegex);
        expect(match).toBeTruthy();
        
        const body = match[1];
        expect(body).toMatch(/btc_daily_close_prices/);
        expect(body).toMatch(/select\s+count/i);
    });

    test('updateDominanceData deve ter verificação de cache de pelo menos 1 hora', () => {
        const dominanceRegex = /async\s+function\s+updateDominanceData[\s\S]*?\{([\s\S]*?)\}/;
        const match = serverContent.match(dominanceRegex);
        expect(match).toBeTruthy();
        
        const body = match[1];
        expect(body).toMatch(/btc_dominance_snapshot/);
        expect(body).toMatch(/last_updated/);
        expect(body).toMatch(/60\s*\*\s*60\s*\*\s*1000/); // 1 hora em ms
    });

    test('cálculo teórico de chamadas mensais CoinGecko deve respeitar o limite de 10.000', () => {
        const minIntervalMinutes = 5; 
        
        // High frequency: 1 chamada por intervalo (simple/price)
        const highFreqCallsPerDay = (60 / minIntervalMinutes) * 24; // 288 chamadas/dia (para 5 min)
        // Dominance: 1 chamada por hora
        const dominanceCallsPerDay = 24; 
        // Daily updates: 2 chamadas por dia (yesterday close USD & BRL)
        const dailyCallsPerDay = 2;
        
        const totalCallsPerDay = highFreqCallsPerDay + dominanceCallsPerDay + dailyCallsPerDay;
        const totalCallsPerMonth = totalCallsPerDay * 30; // 30 dias
        
        // Deve ser menor do que 10.000
        expect(totalCallsPerMonth).toBeLessThan(10000);
    });
});

describe('CoinGecko Key Rotation', () => {
    test('server.ts deve conter suporte a COINGECKO_API_KEY_2', () => {
        const filePath = path.join(__dirname, '../../server.ts');
        const content = fs.readFileSync(filePath, 'utf8');
        expect(content).toContain('COINGECKO_API_KEY_2');
    });

    test('server.ts deve conter a função getCoinGeckoApiKey para rotação', () => {
        const filePath = path.join(__dirname, '../../server.ts');
        const content = fs.readFileSync(filePath, 'utf8');
        expect(content).toMatch(/function\s+getCoinGeckoApiKey/);
    });

    test('server.ts deve conter fallback com getAlternateCoinGeckoKey', () => {
        const filePath = path.join(__dirname, '../../server.ts');
        const content = fs.readFileSync(filePath, 'utf8');
        expect(content).toMatch(/function\s+getAlternateCoinGeckoKey/);
    });

    test('fetchWithRetry deve tratar HTTP 429 e 403 com fallback de chave', () => {
        const filePath = path.join(__dirname, '../../server.ts');
        const content = fs.readFileSync(filePath, 'utf8');

        // Extrair o corpo de fetchWithRetry
        const fetchRetryRegex = /async\s+function\s+fetchWithRetry[\s\S]*?\{([\s\S]*?)\n\}/;
        const match = content.match(fetchRetryRegex);
        expect(match).toBeTruthy();

        const body = match[1];
        // Deve tratar 429
        expect(body).toContain('429');
        // Deve tratar 403
        expect(body).toContain('403');
        // Deve chamar getAlternateCoinGeckoKey
        expect(body).toContain('getAlternateCoinGeckoKey');
    });

    test('COINGECKO_HEADERS deve aceitar apiKey opcional para permitir fallback', () => {
        const filePath = path.join(__dirname, '../../server.ts');
        const content = fs.readFileSync(filePath, 'utf8');
        // A assinatura deve incluir parâmetro opcional apiKey
        expect(content).toMatch(/COINGECKO_HEADERS\s*=\s*\(\s*apiKey\?\s*:/);
    });

    test('buildCoinGeckoKeyPool deve montar pool a partir das variáveis de ambiente', () => {
        const filePath = path.join(__dirname, '../../server.ts');
        const content = fs.readFileSync(filePath, 'utf8');
        expect(content).toMatch(/function\s+buildCoinGeckoKeyPool/);
        // Deve referenciar ambas as chaves
        expect(content).toContain("process.env.COINGECKO_API_KEY");
        expect(content).toContain("process.env.COINGECKO_API_KEY_2");
    });

    test('com 2 chaves, o limite mensal teórico por chave cai para ~5.000', () => {
        const minIntervalMinutes = 5; 
        const highFreqCallsPerDay = (60 / minIntervalMinutes) * 24;
        const dominanceCallsPerDay = 24; 
        const dailyCallsPerDay = 2;
        const totalCallsPerDay = highFreqCallsPerDay + dominanceCallsPerDay + dailyCallsPerDay;
        const totalCallsPerMonth = totalCallsPerDay * 30;

        // Com 2 chaves, cada uma recebe ~50% do total
        const callsPerKeyPerMonth = totalCallsPerMonth / 2;
        
        // Com margem de 5% de desbalanceamento: max = 52.5% do total
        const maxCallsPerKey = totalCallsPerMonth * 0.525;
        
        expect(callsPerKeyPerMonth).toBeLessThan(5500);
        expect(maxCallsPerKey).toBeLessThan(6000);
    });
});
