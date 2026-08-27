'use strict';
/**
 * card-reorder.js — arrastar para reordenar os cards do dashboard.
 * A ordem é persistida em localStorage (por navegador). Progressive enhancement:
 * sem JS, os cards ficam na ordem do SSR.
 */
(function () {
    const STORAGE_KEY = 'bitpanel-card-order';
    const container = document.querySelector('.dashboard-container');
    if (!container) return;

    // Cards reordenáveis = filhos diretos .indicador, exceto a intro (full-width).
    function reorderableCards() {
        return [...container.querySelectorAll(':scope > .indicador:not(.intro-content)')];
    }

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
            .normalize('NFD').replace(/[̀-ͯ]/g, '')   // remove acentos
            .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const key = slug || ('card-' + index);
        card.dataset.card = key;
        return key;
    }

    const initialCards = reorderableCards();
    initialCards.forEach((c, i) => keyFor(c, i));
    const defaultOrder = initialCards.map(c => c.dataset.card);

    // --- Persistência ---
    function loadOrder() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null; }
        catch { return null; }
    }
    function saveOrder() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(reorderableCards().map(c => c.dataset.card))); }
        catch { /* localStorage indisponível */ }
        updateResetButton();
    }
    function applyOrder(order) {
        if (!order || !order.length) return;
        const byKey = new Map(reorderableCards().map(c => [c.dataset.card, c]));
        order.forEach(key => { const card = byKey.get(key); if (card) container.appendChild(card); });
        // Cards novos (ausentes na ordem salva) permanecem no fim, na ordem do SSR.
    }

    // --- Drag & drop (iniciado pelo handle) ---
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
        saveOrder();
    }
    function onCardDragOver(e) {
        if (!dragging) return;
        const card = e.currentTarget;
        if (card === dragging) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const box = card.getBoundingClientRect();
        const before = e.clientX < box.left + box.width / 2;
        container.insertBefore(dragging, before ? card : card.nextSibling);
    }

    function wireCard(card, index) {
        keyFor(card, index);
        const h2 = card.querySelector('h2');
        if (h2 && !h2.querySelector('.card-drag-handle')) {
            const handle = document.createElement('span');
            handle.className = 'card-drag-handle';
            handle.setAttribute('draggable', 'true');
            handle.setAttribute('role', 'button');
            handle.setAttribute('tabindex', '0');
            handle.setAttribute('title', 'Arraste para reordenar');
            handle.setAttribute('aria-label', 'Arraste para reordenar este card');
            handle.textContent = '⠿'; // ⠿
            handle.addEventListener('dragstart', onDragStart);
            handle.addEventListener('dragend', onDragEnd);
            h2.insertBefore(handle, h2.firstChild);
        }
        card.addEventListener('dragover', onCardDragOver);
    }

    // --- Botão "restaurar ordem" (visível só com ordem customizada) ---
    let resetBtn = null;
    function ensureResetButton() {
        const intro = container.querySelector('.intro-content');
        if (!intro) return;
        resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'card-order-reset';
        resetBtn.textContent = '↺ Restaurar ordem dos cards';
        resetBtn.addEventListener('click', () => {
            try { localStorage.removeItem(STORAGE_KEY); } catch (_) { }
            applyOrder(defaultOrder);
            updateResetButton();
        });
        intro.appendChild(resetBtn);
    }
    function updateResetButton() {
        if (resetBtn) resetBtn.style.display = loadOrder() ? '' : 'none';
    }

    // --- Init ---
    applyOrder(loadOrder());
    reorderableCards().forEach((c, i) => wireCard(c, i));
    ensureResetButton();
    updateResetButton();
})();
