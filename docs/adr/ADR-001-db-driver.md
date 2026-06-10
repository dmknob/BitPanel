# ADR-001 — Driver SQLite: `better-sqlite3`

**Status:** Aceito  
**Data:** 2026-06-10  
**Projeto:** BitPanel

---

## Contexto

O BitPanel utiliza SQLite como banco de dados local. Originalmente o projeto
usava os pacotes `sqlite3` (bindings nativos via node-gyp) e `sqlite` (wrapper
assíncrono sobre o `sqlite3`).

Ao implantar no servidor de produção (Debian/Ubuntu com GLIBC < 2.38), o
servidor falhava na inicialização com:

```
Error: /lib/x86_64-linux-gnu/libm.so.6: version `GLIBC_2.38' not found
       (required by .../sqlite3/build/Release/node_sqlite3.node)
```

O `sqlite3` v6+ é compilado contra `GLIBC_2.38`, incompatível com LTS do
Ubuntu 20.04 / Debian Bullseye (GLIBC 2.31–2.35).

---

## Decisão

**Migrar para `better-sqlite3`** como único driver SQLite do projeto.

### ❌ Pacotes REMOVIDOS — não utilizar

| Pacote  | Motivo da remoção |
|---------|-------------------|
| `sqlite3` | Requer `GLIBC_2.38` — incompatível com o ambiente de produção |
| `sqlite`  | Wrapper assíncrono que depende do `sqlite3`; desnecessário |

### ✅ Pacote ADOTADO

| Pacote | Versão mínima | Tipo |
|--------|--------------|------|
| `better-sqlite3` | `^12.10.0` | `dependencies` |
| `@types/better-sqlite3` | `^7.6.13` | `devDependencies` |

---

## Consequências e Diferenças de API

O `better-sqlite3` tem API **síncrona** — sem `await` nas operações de banco.
Isso simplifica o código e elimina race conditions comuns em APIs assíncronas.

### Mapeamento de API

| `sqlite` (antigo) | `better-sqlite3` (novo) |
|---|---|
| `await open({ filename, driver })` | `new Database(path)` |
| `await db.get(sql, params)` | `db.prepare(sql).get(...params)` |
| `await db.all(sql, params)` | `db.prepare(sql).all(...params)` |
| `await db.run(sql, params)` | `db.prepare(sql).run(...params)` |
| `await db.exec(sql)` | `db.exec(sql)` |
| `await db.prepare(sql)` → `stmt.run(...)` → `stmt.finalize()` | `db.prepare(sql)` → `stmt.run(...)` (sem finalize) |
| `result.lastID` | `result.lastInsertRowid` |
| `PRAGMA user_version` via `db.get()` | `db.pragma('user_version', { simple: true })` |
| `db.run('PRAGMA user_version = N')` | `db.pragma('user_version = N')` |

### Boas práticas adotadas

- **WAL mode** ativado no startup: `db.pragma('journal_mode = WAL')` — melhora
  concorrência de leituras sem overhead de locks.
- **Foreign keys** habilitadas: `db.pragma('foreign_keys = ON')`.
- **Transações** para inserções em lote (`db.transaction(fn)`), substituindo
  o loop com múltiplos `await stmt.run()`.
- Statements são preparados inline (`db.prepare(sql).run(...)`) para queries
  únicas, ou pré-compilados em variável para queries repetidas.

---

## Referências

- [better-sqlite3 API docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
- [better-sqlite3 Performance](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md)
- Issue original: `ERR_DLOPEN_FAILED` com GLIBC_2.38 no ambiente de produção
