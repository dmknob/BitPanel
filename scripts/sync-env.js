'use strict';
/**
 * sync-env.js — reconcilia o .env com o .env.example SEM tocar em valores.
 *
 *   node scripts/sync-env.js --check   → lista as variáveis do .env.example
 *                                        ausentes do .env (apenas nomes).
 *                                        Sai com código 1 se houver divergência.
 *   node scripts/sync-env.js           → acrescenta ao .env as variáveis novas
 *                                        (comentário + NOME= vazio), sem alterar
 *                                        nenhuma linha já existente.
 *
 * O .env.example é a fonte de verdade dos NOMES das variáveis. Este script
 * nunca lê nem imprime VALORES — é seguro rodar com segredos no .env.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXAMPLE = path.join(ROOT, '.env.example');
const ENV = path.join(ROOT, '.env');

const mode = process.argv.includes('--check') ? 'check' : 'sync';

/** Extrai o conjunto de nomes de variáveis (linhas NOME=...). */
function parseNames(content) {
    const names = new Set();
    for (const line of content.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
        if (m) names.add(m[1]);
    }
    return names;
}

/** Mapeia nome -> bloco (comentários precedentes + "NOME=" vazio) do example. */
function parseBlocks(content) {
    const blocks = new Map();
    let buffer = [];
    for (const line of content.split(/\r?\n/)) {
        if (/^\s*#/.test(line) || line.trim() === '') {
            buffer.push(line);
            continue;
        }
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
        if (m) {
            const comments = buffer.filter(l => /^\s*#/.test(l));
            // Grava a variável VAZIA — o valor do example (placeholder) é ignorado.
            blocks.set(m[1], [...comments, `${m[1]}=`].join('\n'));
        }
        buffer = [];
    }
    return blocks;
}

if (!fs.existsSync(EXAMPLE)) {
    console.error('sync-env: .env.example não encontrado.');
    process.exit(2);
}
const exampleContent = fs.readFileSync(EXAMPLE, 'utf8');
const exampleNames = parseNames(exampleContent);

if (!fs.existsSync(ENV)) {
    console.error('sync-env: .env não existe. Crie-o a partir do .env.example antes de sincronizar.');
    process.exit(mode === 'check' ? 1 : 2);
}
const envContent = fs.readFileSync(ENV, 'utf8');
const envNames = parseNames(envContent);

const missing = [...exampleNames].filter(n => !envNames.has(n));
const extra = [...envNames].filter(n => !exampleNames.has(n));

if (mode === 'check') {
    if (extra.length) {
        console.log(`sync-env: (info) variáveis no .env sem correspondência no .env.example: ${extra.join(', ')}`);
    }
    if (missing.length === 0) {
        console.log('sync-env: OK — o .env contém todas as variáveis do .env.example.');
        process.exit(0);
    }
    console.error(`sync-env: FALTAM ${missing.length} variável(is) no .env: ${missing.join(', ')}`);
    console.error('Rode "npm run env:sync" para acrescentá-las (com valor vazio, sem tocar nas existentes).');
    process.exit(1);
}

// mode === 'sync'
if (missing.length === 0) {
    console.log('sync-env: nada a fazer — o .env já está em dia com o .env.example.');
    process.exit(0);
}
const blocks = parseBlocks(exampleContent);
const additions = missing.map(n => blocks.get(n) || `${n}=`).join('\n\n');
const prefix = envContent.endsWith('\n') ? '\n' : '\n\n';
fs.appendFileSync(ENV, `${prefix}# --- Acrescentado por sync-env (preencher os valores) ---\n${additions}\n`);
console.log(`sync-env: acrescentada(s) ${missing.length} variável(is) ao .env: ${missing.join(', ')}`);
console.log('Preencha os valores no .env. Nenhuma linha existente foi alterada.');
