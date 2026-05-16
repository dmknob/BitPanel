'use strict';

let tvScheduler = null;
let tvWsPollingInterval = null;

function updateClock() {
    const el = document.getElementById('tv-clock');
    if (el) el.textContent = new Date().toLocaleTimeString('pt-BR');
}
setInterval(updateClock, 1000);
updateClock();

function getFgClass(value) {
    if (value <= 25) return 'fg-extreme-fear';
    if (value <= 45) return 'fg-fear';
    if (value <= 55) return 'fg-neutral';
    if (value <= 75) return 'fg-greed';
    return 'fg-extreme-greed';
}

function renderTv(data) {
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    const setClass = (id, cls) => { const el = document.getElementById(id); if (el) { el.className = el.className.replace(/fg-\S+/, ''); el.classList.add(cls); } };

    const btcBrl = data.prices?.btc_brl;
    const btcUsd = data.prices?.btc_usd;

    if (btcBrl) set('tv-btc-brl', `R$ ${btcBrl.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}`);
    if (btcUsd) set('tv-btc-usd', `$ ${btcUsd.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`);

    const fg = data.fearGreed?.value;
    if (fg != null) {
        set('tv-fg-value', fg);
        set('tv-fg-class', data.fearGreed.classification || '');
        setClass('tv-fg-value', getFgClass(fg));
    }

    const mayer = data.globalMetrics?.mayer_multiple;
    if (mayer != null) {
        const el = document.getElementById('tv-mayer');
        if (el) {
            el.textContent = mayer.toFixed(2);
            el.className = 'tv-value ' + (mayer < 1 ? 'tv-green' : mayer > 2.4 ? 'tv-red' : 'tv-orange');
        }
    }

    const hr = data.network?.hash_rate_eh_s;
    if (hr != null) set('tv-hashrate', `${hr.toFixed(1)} EH/s`);

    const diff = data.network?.difficulty;
    if (diff != null) set('tv-difficulty', `Dificuldade: ${(diff/1e12).toFixed(2)} T`);

    set('tv-fee-fast', data.mempool?.fastest_fee ?? '--');
    set('tv-fee-half', data.mempool?.half_hour_fee ?? '--');
    set('tv-fee-hour', data.mempool?.hour_fee ?? '--');

    const bh = data.mempool?.block_height;
    if (bh) set('tv-block-height', `Bloco #${bh.toLocaleString('pt-BR')}`);

    const dom = data.globalMetrics?.btc_dominance_pct;
    if (dom != null) set('tv-dominance', `${dom.toFixed(1)}%`);

    const s2f = data.globalMetrics?.s2f_ratio;
    if (s2f != null) set('tv-s2f', `S2F: ${s2f.toFixed(1)}`);

    if (data.lightning) {
        if (data.lightning.capacity_btc != null) {
            set('tv-ln-capacity', `${data.lightning.capacity_btc.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} BTC`);
        }
        if (data.lightning.channels != null) {
            set('tv-ln-channels', data.lightning.channels.toLocaleString('pt-BR'));
        }
        if (data.lightning.nodes != null) {
            set('tv-ln-nodes', data.lightning.nodes.toLocaleString('pt-BR'));
        }
    }

    if (data.lastUpdateTimestamp) {
        const t = new Date(data.lastUpdateTimestamp);
        set('tv-last-update', `Última atualização: ${t.toLocaleString('pt-BR')}`);
    }
}

async function fetchTvData() {
    try {
        const res = await fetch('/api/data');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        renderTv(data);
        scheduleNextTvUpdate(data.timeUntilNextUpdate);
    } catch (e) {
        console.error('TV: Erro ao buscar dados:', e.message);
        if (tvScheduler) clearTimeout(tvScheduler);
        tvScheduler = setTimeout(fetchTvData, 30_000);
    }
}

function scheduleNextTvUpdate(ms) {
    if (tvScheduler) clearTimeout(tvScheduler);
    const delay = Math.max(5000, (ms || 600_000) + Math.random() * 10_000);
    tvScheduler = setTimeout(fetchTvData, delay);
}

function startTvWsPollingFallback() {
    if (tvWsPollingInterval) return;
    console.log('TV: WebSocket indisponível. Usando polling a cada 10 minutos.');
    tvWsPollingInterval = setInterval(async () => {
        try {
            const res = await fetch('/api/data');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            renderTv(data);
        } catch (e) {
            console.error('TV polling fallback: erro ao buscar dados:', e.message);
        }
    }, 600_000);
}

function initTvWebSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}`);

    ws.addEventListener('open', () => {
        console.log('TV: WebSocket conectado. Polling desativado.');
        if (tvWsPollingInterval) {
            clearInterval(tvWsPollingInterval);
            tvWsPollingInterval = null;
        }
        // Cancel any scheduled fetch-based polling when WS is active
        if (tvScheduler) {
            clearTimeout(tvScheduler);
            tvScheduler = null;
        }
    });

    ws.addEventListener('message', event => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'update' && msg.data) {
                renderTv(msg.data);
            }
        } catch (e) {
            console.error('TV WebSocket: erro ao processar mensagem:', e.message);
        }
    });

    ws.addEventListener('close', () => {
        console.warn('TV: WebSocket fechado. Ativando polling de fallback.');
        startTvWsPollingFallback();
    });

    ws.addEventListener('error', () => {
        console.error('TV: WebSocket com erro. Ativando polling de fallback.');
        startTvWsPollingFallback();
    });
}

fetchTvData();
initTvWebSocket();
