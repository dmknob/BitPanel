# Migrações do banco de dados

O BitPanel utiliza **migrações automáticas** baseadas no `PRAGMA user_version` do SQLite.

Ao iniciar o servidor, a função `runMigrations()` em `server.js` verifica a versão atual do banco e aplica sequencialmente todas as migrações pendentes, sem necessidade de intervenção manual.

## Migrações existentes

| Versão | Descrição |
|--------|-----------|
| 1 | Schema inicial: `current_prices`, `mempool_snapshot`, `btc_global_metrics_history`, `btc_daily_close_prices`, `fear_greed_history` |
| 2 | Métricas de rede: `network_metrics_snapshot`, `btc_dominance_snapshot` |

## Como adicionar uma nova migração

1. Abra `server.js` e localize a função `runMigrations()`.
2. Incremente o número de versão e adicione um novo bloco `if (currentVersion < N)` com os comandos SQL necessários.
3. Ao reiniciar o servidor, a migração será aplicada automaticamente.

> **Atenção:** nunca altere ou remova migrações já aplicadas em produção. Sempre adicione novas migrações de forma incremental.
