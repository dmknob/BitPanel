'use strict';
/**
 * card-reorder.js — layout em COLUNAS independentes, arrastáveis (estilo Kanban).
 *
 * Cada coluna é uma pilha vertical própria: um card baixinho é seguido
 * imediatamente pelo próximo da mesma coluna, sem deixar buraco por causa de um
 * card mais alto numa coluna vizinha. O usuário escolhe o nº de colunas (2–5),
 * arrasta cards dentro e entre colunas, e a disposição (quais cards em cada
 * coluna + ordem + nº de colunas) é persistida em localStorage por navegador.
 *
 * Progressive enhancement: sem JS, o CSS mantém o grid padrão.
 */
(function () {
    const LAYOUT_KEY = 'bitpanel-card-layout';
    const OLD_ORDER_KEY = 'bitpanel-card-order'; // versão anterior (ordem plana)
    const MIN_COLS = 2, MAX_COLS = 5, DEFAULT_COLS = 3;

    const container = document.querySelector('.dashboard-container');
    if (!container) return;

    // Chave estável: id existente, ou slug do <h2> (sem a etiqueta .fonte-api).
    function keyFor(card, index) {
        if (card.dataset.card) return card.dataset.card;
        let base = card.id || '';
        if (!base) {
            const h2 = card.querySelector('h2');
            if (h2) {
                const clone = h2.cloneNode(true);
                clone.querySelectorAll('.fonte-api, .card-drag-handle').forEach(n => n.remove());
                base = clone.textContent || '';
            }
        }
        const slug = base.trim().toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const key = slug || ('card-' + index);
        card.dataset.card = key;
        return key;
    }

    const dataCards = [...container.querySelectorAll(':scope > .indicador:not(.intro-content)')];
    if (!dataCards.length) return;
    dataCards.forEach((c, i) => keyFor(c, i));
    const cardByKey = new Map(dataCards.map(c => [c.dataset.card, c]));
    const allKeys = dataCards.map(c => c.dataset.card);

    // --- Persistência ---
    function loadLayout() {
        try {
            const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY));
            if (raw && Array.isArray(raw.columns) && raw.cols) return raw;
        } catch (_) { }
        return null;
    }
    function saveLayout(l) {
        try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(l)); } catch (_) { }
    }
    function defaultLayout(cols) {
        // Sequência: usa a ordem da versão anterior (plana), se existir; senão a do SSR.
        let seq = allKeys;
        try {
            const old = JSON.parse(localStorage.getItem(OLD_ORDER_KEY));
            if (Array.isArray(old) && old.length) {
                const known = old.filter(k => cardByKey.has(k));
                seq = [...known, ...allKeys.filter(k => !known.includes(k))];
            }
        } catch (_) { }
        const columns = Array.from({ length: cols }, () => []);
        seq.forEach((k, i) => columns[i % cols].push(k)); // round-robin (colunas equilibradas)
        return { cols, columns };
    }
    // Garante que cada card conhecido apareça exatamente uma vez; descarta chaves
    // desconhecidas; cards novos vão pra coluna mais curta.
    function normalize(l) {
        const cols = Math.min(MAX_COLS, Math.max(MIN_COLS, l.cols || DEFAULT_COLS));
        const columns = Array.from({ length: cols }, () => []);
        const placed = new Set();
        (l.columns || []).forEach((colKeys, ci) => {
            const target = Math.min(ci, cols - 1); // se reduziu colunas, excedente vai pra última
            (colKeys || []).forEach(k => {
                if (cardByKey.has(k) && !placed.has(k)) { columns[target].push(k); placed.add(k); }
            });
        });
        allKeys.filter(k => !placed.has(k)).forEach(k => {
            let mi = 0;
            for (let i = 1; i < cols; i++) if (columns[i].length < columns[mi].length) mi = i;
            columns[mi].push(k);
        });
        return { cols, columns };
    }

    let layout = normalize(loadLayout() || defaultLayout(DEFAULT_COLS));

    // --- Drag & drop (vertical, entre colunas) ---
    let dragging = null;
    function onDragStart(e) {
        dragging = e.currentTarget.closest('.indicador');
        if (!dragging) return;
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', dragging.dataset.card || ''); } catch (_) { }
        try { e.dataTransfer.setDragImage(dragging, 24, 24); } catch (_) { }
        requestAnimationFrame(() => { if (dragging) dragging.classList.add('dragging'); });
    }
    function onDragEnd() {
        if (dragging) dragging.classList.remove('dragging');
        dragging = null;
        columnEls.forEach(c => c.classList.remove('col-drop'));
        persist();
    }
    function afterElement(col, y) {
        const cards = [...col.querySelectorAll(':scope > .indicador:not(.dragging)')];
        for (const c of cards) {
            const box = c.getBoundingClientRect();
            if (y < box.top + box.height / 2) return c;
        }
        return null;
    }
    function wireColumn(col) {
        col.addEventListener('dragover', (e) => {
            if (!dragging) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const ref = afterElement(col, e.clientY);
            if (ref) col.insertBefore(dragging, ref); else col.appendChild(dragging);
            columnEls.forEach(c => c.classList.toggle('col-drop', c === col));
        });
    }
    function wireCardHandle(card) {
        const h2 = card.querySelector('h2');
        if (h2 && !h2.querySelector('.card-drag-handle')) {
            const handle = document.createElement('span');
            handle.className = 'card-drag-handle';
            handle.setAttribute('draggable', 'true');
            handle.setAttribute('title', 'Arraste para mover entre colunas / reordenar');
            handle.setAttribute('aria-label', 'Arraste para mover este card');
            handle.textContent = '⠿';
            handle.addEventListener('dragstart', onDragStart);
            handle.addEventListener('dragend', onDragEnd);
            h2.insertBefore(handle, h2.firstChild);
        }
    }

    // --- Render das colunas ---
    let columnsWrap = null, columnEls = [];
    function render() {
        container.classList.add('columns-mode');
        if (!columnsWrap) {
            columnsWrap = document.createElement('div');
            columnsWrap.className = 'dashboard-columns';
            container.appendChild(columnsWrap);
        }
        // Detach cards (mantidos vivos via cardByKey), recria colunas, redistribui.
        columnsWrap.textContent = '';
        columnEls = [];
        layout.columns.forEach((colKeys) => {
            const col = document.createElement('div');
            col.className = 'dashboard-column';
            colKeys.forEach(k => { const c = cardByKey.get(k); if (c) col.appendChild(c); });
            wireColumn(col);
            columnsWrap.appendChild(col);
            columnEls.push(col);
        });
    }
    function readLayoutFromDOM() {
        return {
            cols: layout.cols,
            columns: columnEls.map(col =>
                [...col.querySelectorAll(':scope > .indicador')].map(c => c.dataset.card))
        };
    }
    function persist() { layout = readLayoutFromDOM(); saveLayout(layout); }

    // --- Toolbar (nº de colunas + restaurar) ---
    let toolbar = null;
    function refreshToolbar() {
        if (!toolbar) return;
        toolbar.querySelectorAll('.cards-col-btn').forEach(b =>
            b.setAttribute('aria-pressed', String(Number(b.dataset.n) === layout.cols)));
    }
    function setCols(n) {
        if (n === layout.cols) return;
        layout = normalize({ cols: n, columns: readLayoutFromDOM().columns });
        render();
        refreshToolbar();
        saveLayout(layout);
    }
    function buildToolbar() {
        const bar = document.createElement('div');
        bar.className = 'cards-toolbar';
        const label = document.createElement('span');
        label.className = 'cards-toolbar-label';
        label.textContent = 'Colunas:';
        bar.appendChild(label);
        for (let n = MIN_COLS; n <= MAX_COLS; n++) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'cards-col-btn';
            b.dataset.n = n;
            b.textContent = n;
            b.addEventListener('click', () => setCols(n));
            bar.appendChild(b);
        }
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'cards-reset-btn';
        reset.textContent = '↺ Restaurar';
        reset.addEventListener('click', () => {
            try { localStorage.removeItem(LAYOUT_KEY); } catch (_) { }
            layout = defaultLayout(DEFAULT_COLS);
            render();
            refreshToolbar();
        });
        bar.appendChild(reset);
        container.insertBefore(bar, columnsWrap); // entre a intro e as colunas
        toolbar = bar;
        refreshToolbar();
    }

    // --- Init ---
    render();
    dataCards.forEach((c, i) => wireCardHandle(c));
    buildToolbar();
    saveLayout(layout);
})();
