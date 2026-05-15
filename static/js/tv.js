'use strict';

let tvScheduler = null;

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

    if (data.lastUpdateTimestamp) {
        const t = new Date(data.lastUpdateTimestamp);
        set('tv-last-update', `Última atualização: ${t.toLocaleString('pt-BR')}`);
    }

    scheduleNextTvUpdate(data.timeUntilNextUpdate);
}

async function fetchTvData() {
    try {
        const res = await fetch('/api/data');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        renderTv(data);
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

fetchTvData();
