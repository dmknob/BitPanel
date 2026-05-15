// IDs dos Elementos HTML
const precoBrlElement = document.getElementById('bitcoin-preco-brl');
const precoUsdElement = document.getElementById('bitcoin-preco-usd');
const usdtBrlPriceElement = document.getElementById('usdtbrl-price');
const marketCapUsdElement = document.getElementById('bitcoin-marketcap-usd');
const mayerMultipleElement = document.getElementById('bitcoin-mayer-multiple');
const fearGreedValueElement = document.getElementById('fear-greed-value');
const fearGreedClassificationElement = document.getElementById('fear-greed-classification');
const fearGreedLastUpdatedElement = document.getElementById('fear-greed-last-updated');
const feeFastestElement = document.getElementById('mempool-fee-fastest');
const feeHalfHourElement = document.getElementById('mempool-fee-halfhour');
const feeHourElement = document.getElementById('mempool-fee-hour');
const blockHeightElement = document.getElementById('mempool-block-height');
const totalBtcSupplyElement = document.getElementById('total-btc-supply');
const mempoolTxCountElement = document.getElementById('mempool-tx-count');
const satsInputElement = document.getElementById('sats-input');
const satsToBrlElement = document.getElementById('sats-to-brl');
const satsToUsdElement = document.getElementById('sats-to-usd');
const lastUpdateTimeElement = document.getElementById('last-update-time');
const bitcoinPrecoEurElement = document.getElementById('bitcoin-preco-eur');
const btcS2fRatioElement = document.getElementById('btc-s2f-ratio');
const btcDominanceElement = document.getElementById('btc-dominance');
const btcHashRateElement = document.getElementById('btc-hash-rate');
const btcDifficultyElement = document.getElementById('btc-difficulty');
const btcDifficultyChangeElement = document.getElementById('btc-difficulty-change');
const btcAvgBlockTimeElement = document.getElementById('btc-avg-block-time');

// Portfólio
const portfolioBtcInput = document.getElementById('portfolio-btc');
const portfolioAvgPriceInput = document.getElementById('portfolio-avg-price');
const portfolioSaveBtn = document.getElementById('portfolio-save-btn');
const portfolioCurrentValueEl = document.getElementById('portfolio-current-value');
const portfolioPlEl = document.getElementById('portfolio-pl');
const portfolioPlPctEl = document.getElementById('portfolio-pl-pct');

// Variáveis globais
let currentBitcoinPriceUSD = 0;
let currentBitcoinPriceBRL = 0;
const SATS_PER_BTC = 100000000;
let updateScheduler = null;
let priceChart = null;
let fearGreedChart = null;
let currentChartDays = 30;

// Configurações do Agendador
const JITTER_MS = 10000; // Variação aleatória de até 10 segundos


// --- FUNÇÃO DE RENDERIZAÇÃO ---
function renderData(data) {

    // CHAMA A FUNÇÃO GLOBAL para atualizar o timestamp principal
    if (typeof updateGlobalTimestamp === 'function') {
        updateGlobalTimestamp(data.lastUpdateTimestamp);
    }
    
    if (!data) return;

    if (data.lastUpdateTimestamp) {
        const updateTime = new Date(data.lastUpdateTimestamp);
        lastUpdateTimeElement.textContent = updateTime.toLocaleTimeString('pt-BR');
    } else {
        lastUpdateTimeElement.textContent = "Aguardando...";
    }

    currentBitcoinPriceUSD = data.prices?.btc_usd || 0;
    currentBitcoinPriceBRL = data.prices?.btc_brl || 0;
    const precoUsdtBrl = data.prices?.usdt_brl || 0;
    
    precoBrlElement.textContent = `R$ ${currentBitcoinPriceBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    precoUsdElement.textContent = `$ ${currentBitcoinPriceUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    usdtBrlPriceElement.textContent = `R$ ${precoUsdtBrl.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
    
    marketCapUsdElement.textContent = `$ ${data.globalMetrics?.market_cap_usd?.toLocaleString('en-US', {maximumFractionDigits: 0}) || 'N/D'}`;
    mayerMultipleElement.textContent = data.globalMetrics?.mayer_multiple?.toFixed(2) || 'N/D';

    fearGreedValueElement.textContent = data.fearGreed?.value || 'N/D';
    fearGreedClassificationElement.textContent = data.fearGreed?.classification || 'N/D';
    if (data.fearGreed?.last_updated) {
        fearGreedLastUpdatedElement.textContent = new Date(data.fearGreed.last_updated).toLocaleString('pt-BR');
    } else {
        fearGreedLastUpdatedElement.textContent = 'N/D';
    }

    feeFastestElement.textContent = `${data.mempool?.fastest_fee || 'N/D'} sat/vB`;
    feeHalfHourElement.textContent = `${data.mempool?.half_hour_fee || 'N/D'} sat/vB`;
    feeHourElement.textContent = `${data.mempool?.hour_fee || 'N/D'} sat/vB`;
    blockHeightElement.textContent = data.mempool?.block_height?.toLocaleString('pt-BR') || 'N/D';
    totalBtcSupplyElement.textContent = data.mempool?.calculated_supply?.toLocaleString('pt-BR', {maximumFractionDigits: 0}) || 'N/D';
    mempoolTxCountElement.textContent = data.mempool?.tx_count?.toLocaleString('pt-BR') || 'N/D';

    // EUR price
    if (bitcoinPrecoEurElement) {
        bitcoinPrecoEurElement.textContent = data.prices?.btc_eur
            ? `€ ${data.prices.btc_eur.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : 'N/D';
    }

    // S2F
    if (btcS2fRatioElement) {
        btcS2fRatioElement.textContent = data.globalMetrics?.s2f_ratio != null
            ? data.globalMetrics.s2f_ratio.toFixed(1)
            : 'N/D';
    }

    // Dominância
    if (btcDominanceElement) {
        btcDominanceElement.textContent = data.globalMetrics?.btc_dominance_pct != null
            ? `${data.globalMetrics.btc_dominance_pct.toFixed(2)}%`
            : 'N/D';
    }

    // Hash rate
    if (btcHashRateElement) {
        btcHashRateElement.textContent = data.network?.hash_rate_eh_s != null
            ? `${data.network.hash_rate_eh_s.toFixed(2)} EH/s`
            : 'N/D';
    }

    // Dificuldade
    if (btcDifficultyElement) {
        btcDifficultyElement.textContent = data.network?.difficulty != null
            ? (data.network.difficulty / 1e12).toFixed(2) + ' T'
            : 'N/D';
    }
    if (btcDifficultyChangeElement && data.network?.difficulty_change_pct != null) {
        const pct = data.network.difficulty_change_pct;
        btcDifficultyChangeElement.textContent = `Próximo ajuste estimado: ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
        btcDifficultyChangeElement.style.color = pct >= 0 ? 'var(--accent-color-2)' : '#dc3545';
    }

    // Tempo médio de bloco
    if (btcAvgBlockTimeElement && data.network?.avg_block_time_seconds != null) {
        const minutes = (data.network.avg_block_time_seconds / 60).toFixed(1);
        btcAvgBlockTimeElement.textContent = `${minutes} min`;
    }

    if (satsInputElement && satsInputElement.value) calculateSatsConversion();

    // Atualiza portfólio com preço atual
    renderPortfolio();
}

// --- LÓGICA DE ATUALIZAÇÃO INTELIGENTE ---
async function fetchAllData() {
    console.log("Buscando dados atualizados do servidor...");
    try {
        const response = await fetch('api/data'); 
        if (!response.ok) {
            throw new Error(`Servidor não está pronto ou respondeu com erro: ${response.status}`);
        }
        const freshData = await response.json();
        if (typeof freshData.timeUntilNextUpdate !== 'number') {
            throw new Error("Resposta do servidor não continha a instrução de tempo 'timeUntilNextUpdate'.");
        }
        localStorage.setItem('cachedData', JSON.stringify(freshData));
        renderData(freshData);
        console.log("Dados renderizados com sucesso.");
        scheduleNextUpdate(freshData.timeUntilNextUpdate);
    } catch (error) {
        console.error('Falha na requisição de dados:', error.message);
        console.log("Tentando novamente em 30 segundos...");
        if (updateScheduler) clearTimeout(updateScheduler);
        updateScheduler = setTimeout(fetchAllData, 30000);
    }
}

function scheduleNextUpdate(timeFromServerMs) {
    if (updateScheduler) clearTimeout(updateScheduler);
    if (typeof timeFromServerMs !== 'number') {
        console.error("Instrução de tempo do servidor inválida. Tentando novamente em 60s.");
        updateScheduler = setTimeout(fetchAllData, 60000);
        return;
    }
    const randomJitter = Math.random() * JITTER_MS;
    let finalDelay = timeFromServerMs + randomJitter;
    if (finalDelay < 5000) {
        finalDelay = 5000;
    }
    console.log(`Próxima atualização agendada para daqui a ${Math.round(finalDelay / 1000)} segundos (instrução do servidor).`);
    updateScheduler = setTimeout(fetchAllData, finalDelay);
}

// --- FUNÇÃO DA CALCULADORA SATS ---
function calculateSatsConversion() {
    if (!satsInputElement || !satsToBrlElement || !satsToUsdElement) return;
    const satsAmount = parseFloat(satsInputElement.value);
    if (isNaN(satsAmount) || satsAmount <= 0 || currentBitcoinPriceBRL === 0 || currentBitcoinPriceUSD === 0) {
        satsToBrlElement.textContent = 'R$ 0.00';
        satsToUsdElement.textContent = '$ 0.00';
        return;
    }
    const btcAmount = satsAmount / SATS_PER_BTC;
    const valueInBRL = btcAmount * currentBitcoinPriceBRL;
    const valueInUSD = btcAmount * currentBitcoinPriceUSD;
    satsToBrlElement.textContent = `R$ ${valueInBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}`;
    satsToUsdElement.textContent = `$ ${valueInUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}`;
}

// --- FUNÇÕES DE GRÁFICO ---
async function loadPriceChart(days) {
    currentChartDays = days;
    const canvas = document.getElementById('price-chart');
    if (!canvas) return;

    try {
        const res = await fetch(`/api/historical-prices?days=${days}`);
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) return;

        const labels = data.map(d => d.date);
        const prices = data.map(d => d.price_usd);

        if (priceChart) priceChart.destroy();
        const isDark = document.body.classList.contains('dark-mode');
        const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
        const textColor = isDark ? '#a0a0a0' : '#555';

        priceChart = new Chart(canvas, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'BTC/USD',
                    data: prices,
                    borderColor: '#ff9900',
                    backgroundColor: 'rgba(255,153,0,0.1)',
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: true,
                    tension: 0.3,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => `$ ${ctx.raw.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
                        },
                    },
                },
                scales: {
                    x: {
                        ticks: {
                            maxTicksLimit: 6,
                            color: textColor,
                            maxRotation: 0,
                        },
                        grid: { color: gridColor },
                    },
                    y: {
                        ticks: {
                            color: textColor,
                            callback: v => `$${(v / 1000).toFixed(0)}k`,
                        },
                        grid: { color: gridColor },
                    },
                },
            },
        });
    } catch (e) {
        console.error('Erro ao carregar gráfico de preços:', e);
    }
}

async function loadFearGreedChart() {
    const canvas = document.getElementById('fear-greed-chart');
    if (!canvas) return;
    try {
        const res = await fetch('/api/fear-greed-history');
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) return;

        const labels = data.map(d => d.date);
        const values = data.map(d => d.value);

        const colors = values.map(v => {
            if (v <= 25) return '#dc3545';      // Extreme Fear
            if (v <= 45) return '#fd7e14';      // Fear
            if (v <= 55) return '#ffc107';      // Neutral
            if (v <= 75) return '#28a745';      // Greed
            return '#20c997';                   // Extreme Greed
        });

        if (fearGreedChart) fearGreedChart.destroy();
        const isDark = document.body.classList.contains('dark-mode');
        const textColor = isDark ? '#a0a0a0' : '#555';
        const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';

        fearGreedChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Fear & Greed',
                    data: values,
                    backgroundColor: colors,
                    borderRadius: 2,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const d = data[ctx.dataIndex];
                                return `${d.value} — ${d.classification}`;
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        ticks: { maxTicksLimit: 6, color: textColor, maxRotation: 0 },
                        grid: { color: gridColor },
                    },
                    y: {
                        min: 0,
                        max: 100,
                        ticks: { color: textColor },
                        grid: { color: gridColor },
                    },
                },
            },
        });
    } catch (e) {
        console.error('Erro ao carregar gráfico Fear & Greed:', e);
    }
}

// --- PORTFÓLIO PESSOAL ---
function loadPortfolioInputs() {
    const btc = localStorage.getItem('portfolio_btc');
    const avg = localStorage.getItem('portfolio_avg_brl');
    if (btc && portfolioBtcInput) portfolioBtcInput.value = btc;
    if (avg && portfolioAvgPriceInput) portfolioAvgPriceInput.value = avg;
}

function renderPortfolio() {
    const btc = parseFloat(localStorage.getItem('portfolio_btc')) || 0;
    const avgBrl = parseFloat(localStorage.getItem('portfolio_avg_brl')) || 0;
    if (!portfolioCurrentValueEl) return;
    if (btc <= 0 || currentBitcoinPriceBRL <= 0) {
        portfolioCurrentValueEl.textContent = btc > 0 ? 'Aguardando cotação...' : 'Configure seu portfólio abaixo';
        if (portfolioPlEl) portfolioPlEl.textContent = '';
        if (portfolioPlPctEl) portfolioPlPctEl.textContent = '';
        return;
    }
    const currentValueBrl = btc * currentBitcoinPriceBRL;
    const currentValueUsd = btc * currentBitcoinPriceUSD;
    const costBasis = btc * avgBrl;
    const pl = currentValueBrl - costBasis;
    const plPct = costBasis > 0 ? (pl / costBasis) * 100 : 0;
    const plClass = pl >= 0 ? 'profit' : 'loss';

    portfolioCurrentValueEl.textContent = `R$ ${currentValueBrl.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})} · $ ${currentValueUsd.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
    if (portfolioPlEl) {
        portfolioPlEl.className = plClass;
        portfolioPlEl.textContent = avgBrl > 0
            ? `P&L: ${pl >= 0 ? '+' : ''}R$ ${pl.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}`
            : '';
    }
    if (portfolioPlPctEl) {
        portfolioPlPctEl.textContent = avgBrl > 0 ? `${pl >= 0 ? '+' : ''}${plPct.toFixed(2)}%` : '';
    }
}

// --- PUSH NOTIFICATIONS / ALERTAS ---
let pushSubscription = null;

async function initAlerts() {
    const statusEl = document.getElementById('alerts-support-msg');
    const enableBtn = document.getElementById('alerts-enable-btn');
    const disableBtn = document.getElementById('alerts-disable-btn');
    const formEl = document.getElementById('alerts-form');

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        if (statusEl) statusEl.textContent = 'Push Notifications não suportadas neste navegador.';
        return;
    }

    // Verificar se notificações já estão ativas
    const perm = Notification.permission;
    const storedEndpoint = localStorage.getItem('push_endpoint');

    if (perm === 'granted' && storedEndpoint) {
        if (statusEl) statusEl.textContent = '🔔 Notificações ativas';
        if (enableBtn) enableBtn.style.display = 'none';
        if (disableBtn) disableBtn.style.display = 'inline-block';
        if (formEl) formEl.style.display = 'block';
        loadAlertsList(storedEndpoint);
    } else if (perm === 'denied') {
        if (statusEl) statusEl.textContent = '🚫 Notificações bloqueadas no navegador. Habilite nas configurações do site.';
    } else {
        if (statusEl) statusEl.textContent = 'Ative as notificações para receber alertas de preço.';
        if (enableBtn) enableBtn.style.display = 'inline-block';
    }

    enableBtn?.addEventListener('click', enablePushNotifications);
    disableBtn?.addEventListener('click', disablePushNotifications);
    document.getElementById('alert-add-btn')?.addEventListener('click', addAlert);
}

async function enablePushNotifications() {
    try {
        const keyRes = await fetch('/api/push/vapid-public-key');
        if (!keyRes.ok) {
            alert('Servidor não suporta push notifications. Configure VAPID_PUBLIC_KEY no .env.');
            return;
        }
        const { publicKey } = await keyRes.json();

        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
            alert('Permissão de notificação negada.');
            return;
        }

        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
        });

        const res = await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sub.toJSON()),
        });
        if (!res.ok) throw new Error('Erro ao registrar no servidor.');

        pushSubscription = sub;
        localStorage.setItem('push_endpoint', sub.endpoint);

        document.getElementById('alerts-support-msg').textContent = '🔔 Notificações ativas';
        document.getElementById('alerts-enable-btn').style.display = 'none';
        document.getElementById('alerts-disable-btn').style.display = 'inline-block';
        document.getElementById('alerts-form').style.display = 'block';
        loadAlertsList(sub.endpoint);
    } catch (e) {
        console.error('Erro ao ativar push:', e);
        alert('Erro ao ativar notificações: ' + e.message);
    }
}

async function disablePushNotifications() {
    const endpoint = localStorage.getItem('push_endpoint');
    if (endpoint) {
        await fetch('/api/push/subscribe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint }),
        }).catch(() => {});
    }
    localStorage.removeItem('push_endpoint');
    document.getElementById('alerts-support-msg').textContent = 'Notificações desativadas.';
    document.getElementById('alerts-enable-btn').style.display = 'inline-block';
    document.getElementById('alerts-disable-btn').style.display = 'none';
    document.getElementById('alerts-form').style.display = 'none';
    document.getElementById('alerts-list').innerHTML = '';
}

async function addAlert() {
    const endpoint = localStorage.getItem('push_endpoint');
    if (!endpoint) { alert('Ative as notificações primeiro.'); return; }

    const currency = document.getElementById('alert-currency')?.value;
    const direction = document.getElementById('alert-direction')?.value;
    const threshold = parseFloat(document.getElementById('alert-threshold')?.value);

    if (!threshold || threshold <= 0) { alert('Digite um valor de referência válido.'); return; }

    const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, currency, direction, threshold }),
    });
    if (!res.ok) { const d = await res.json(); alert(d.error || 'Erro ao criar alerta.'); return; }

    document.getElementById('alert-threshold').value = '';
    loadAlertsList(endpoint);
}

async function loadAlertsList(endpoint) {
    const listEl = document.getElementById('alerts-list');
    if (!listEl) return;
    try {
        const res = await fetch(`/api/alerts?endpoint=${encodeURIComponent(endpoint)}`);
        const alerts = await res.json();
        if (!alerts.length) { listEl.innerHTML = '<p style="font-size:0.85em; color: var(--text-color-secondary);">Nenhum alerta configurado.</p>'; return; }
        listEl.innerHTML = alerts.map(a => {
            const sym = a.currency === 'USD' ? '$' : 'R$';
            const dir = a.direction === 'above' ? '↑ acima de' : '↓ abaixo de';
            const status = a.active ? '🔔' : '✅ disparado';
            return `<div class="alert-item">
                <span>${status} BTC/${a.currency} ${dir} ${sym}${Number(a.threshold).toLocaleString('pt-BR')}</span>
                ${a.active ? `<button class="alert-delete-btn" data-id="${a.id}">✕</button>` : ''}
            </div>`;
        }).join('');
        listEl.querySelectorAll('.alert-delete-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                await fetch(`/api/alerts/${btn.dataset.id}`, { method: 'DELETE' });
                loadAlertsList(endpoint);
            });
        });
    } catch (e) {
        listEl.innerHTML = '<p style="font-size:0.85em;">Erro ao carregar alertas.</p>';
    }
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// --- INICIALIZAÇÃO DA PÁGINA ---
document.addEventListener('DOMContentLoaded', () => {
    try {
        const cachedData = JSON.parse(localStorage.getItem('cachedData'));
        if (cachedData) {
            console.log("Renderizando dados do cache do localStorage...");
            renderData(cachedData);
        }
    } catch (e) {
        console.error("Não foi possível ler os dados do cache:", e);
    }
    fetchAllData();

    // Portfólio
    loadPortfolioInputs();
    renderPortfolio();

    portfolioSaveBtn?.addEventListener('click', () => {
        const btc = parseFloat(portfolioBtcInput?.value) || 0;
        const avg = parseFloat(portfolioAvgPriceInput?.value) || 0;
        localStorage.setItem('portfolio_btc', btc);
        localStorage.setItem('portfolio_avg_brl', avg);
        renderPortfolio();
        portfolioSaveBtn.textContent = '✅ Salvo!';
        setTimeout(() => { portfolioSaveBtn.textContent = 'Salvar'; }, 1500);
    });

    // Alertas de preço
    initAlerts();

    // Inicializar gráficos
    loadPriceChart(30);
    loadFearGreedChart();

    // Seletores de período do gráfico de preços
    document.querySelectorAll('.chart-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.chart-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            loadPriceChart(parseInt(btn.dataset.days));
        });
    });

    // Recriar gráficos quando o tema mudar
    document.getElementById('checkbox')?.addEventListener('change', () => {
        setTimeout(() => {
            if (priceChart) loadPriceChart(currentChartDays);
            if (fearGreedChart) loadFearGreedChart();
        }, 350);
    });

    if (satsInputElement) {
        satsInputElement.addEventListener('input', calculateSatsConversion);
        calculateSatsConversion();
    }
});