# Plano de Desenvolvimentos Futuros

tags: #plano #roadmap #features

> Funcionalidades e evoluções arquiteturais para as próximas versões do BitPanel. Organizadas em ondas de complexidade crescente.

---

## Onda 1 — Qualidade e Infraestrutura (Baixo risco)

### F1 · Suite de testes automatizados

**Por quê:** Atualmente não há nenhum teste. Qualquer mudança nos workers ou na lógica de negócio é feita às cegas.

**Escopo:**
- Testes unitários: `calculateBitcoinSupply`, lógica de DCA, formatação de dados
- Testes de integração: endpoints `/api/data` e `/api/historical-prices` com banco em memória (`:memory:`)
- Framework recomendado: **Jest** + **supertest**

**Entregável:** Cobertura mínima de 70% nas funções críticas.

---

### F2 · Containerização com Docker

**Por quê:** O deploy atual depende de PM2 + Nginx configurados manualmente. Docker simplifica reprodução do ambiente, CI/CD e escalonamento futuro.

**Escopo:**
- `Dockerfile` multi-stage (build + runtime)
- `docker-compose.yml` com volume persistente para o SQLite
- Compatível com deploy em VPS, Railway, Fly.io, etc.

---

### F3 · Pipeline CI/CD com GitHub Actions

**Por quê:** Sem CI, bugs podem ser enviados para produção sem validação.

**Escopo:**
- Workflow: `lint → test → build → deploy`
- Deploy automático para VPS via SSH ao merge na `main`
- Badge de status no README

---

### F4 · Sistema de migrations de banco de dados

**Por quê:** As tabelas são criadas com `CREATE TABLE IF NOT EXISTS` diretamente no `server.js`. Adicionar colunas ou índices futuros exigirá scripts manuais e pode quebrar instâncias existentes.

**Solução:** Usar **Knex.js** ou arquivos de migration numerados sequencialmente, aplicados automaticamente na inicialização.

---

### F5 · Monitoramento de erros com Sentry

**Por quê:** Erros de worker em produção são logados apenas no arquivo de log do PM2. Sem alertas proativos.

**Escopo:**
- Integrar `@sentry/node` para captura automática de exceções não tratadas
- Alertas por e-mail/Slack em caso de erro repetido

---

## Onda 2 — Novos Indicadores (Médio impacto)

### F6 · Gráficos históricos interativos no dashboard

**Por quê:** O banco já armazena 365 dias de preços, Mayer Multiple e Market Cap, mas o frontend exibe apenas o valor atual. Os dados históricos só são usados na calculadora DCA.

**Escopo:**
- Gráfico de preço BTC (USD/BRL) com seletor de período: 30d / 90d / 365d
- Gráfico do Mayer Multiple com faixas de referência (< 1.0, 1.0–2.4, > 2.4)
- Biblioteca recomendada: **Chart.js** (leve, sem framework)

---

### F7 · Mais indicadores on-chain

**Por quê:** O painel tem Mayer Multiple e Fear & Greed, mas investidores Bitcoin usam outros indicadores clássicos.

**Indicadores prioritários:**

| Indicador | Fonte de dados | Complexidade |
|-----------|----------------|-------------|
| Stock-to-Flow (S2F) | Calculado internamente | Baixa |
| Dominância do Bitcoin | CoinGecko `/global` | Baixa |
| Hash Rate (7d MA) | Mempool.space | Média |
| Dificuldade de mineração | Mempool.space | Média |
| RHODL Ratio | Glassnode / Bitquery | Alta |
| NUPL (Net Unrealized P&L) | Glassnode | Alta |

---

### F8 · Suporte multi-moeda (EUR, ARS, GBP)

**Por quê:** O painel exibe preços em BRL e USD. Usuários de outros países precisam de conversão manual.

**Escopo:**
- Seletor de moeda de referência no header (persiste em localStorage)
- CoinGecko já suporta `vs_currencies=eur,gbp,ars` na mesma chamada
- Sem custo extra de API

---

### F9 · Histórico do Mayer Multiple no banco

**Por quê:** O Mayer Multiple atual é calculado on-the-fly na requisição, sem persistência. Impossível exibir histórico.

**Solução:** Calcular e persistir o Mayer Multiple diariamente junto ao preço de fechamento:
```sql
ALTER TABLE btc_daily_close_prices ADD COLUMN mayer_multiple REAL;
```

---

### F10 · Índice Fear & Greed histórico no dashboard

**Por quê:** A tabela `fear_greed_history` acumula dados diários, mas o frontend só mostra o valor de hoje.

**Escopo:**
- Endpoint `/api/fear-greed-history` retornando últimos 90 dias
- Mini gráfico de área na seção Fear & Greed do dashboard

---

## Onda 3 — Funcionalidades do Usuário (Alto impacto)

### F11 · Rastreador de portfólio pessoal

**Por quê:** O principal caso de uso do BitPanel é acompanhar um investimento em Bitcoin. Hoje o usuário vê o preço mas não o valor de sua carteira.

**Escopo mínimo (sem autenticação):**
- Campo para inserir saldo em BTC (salvo em localStorage)
- Cálculo do valor atual em BRL/USD
- Cálculo de P&L se o usuário informar preço médio de compra

**Escopo avançado (com autenticação):**
- Histórico de aportes com data e valor
- Gráfico de evolução do patrimônio vs. preço BTC

---

### F12 · Alertas de preço (Push Notifications)

**Por quê:** O usuário precisa ficar com a aba aberta para saber quando o preço atingiu um nível de interesse.

**Escopo:**
- Integrar **Web Push API** no Service Worker existente
- Interface para definir alertas: "avisar quando BTC < R$ X" ou "quando BTC > R$ X"
- Backend persiste os alertas, verifica a cada ciclo do worker e envia via VAPID

**Dependências:** Biblioteca `web-push` no servidor.

---

### F13 · Calculadora DCA — Exportação de resultados

**Por quê:** Usuários querem compartilhar ou guardar o resultado da simulação DCA.

**Escopo:**
- Botão "Exportar CSV" com a tabela de aportes simulados
- Botão "Copiar resumo" (texto formatado para WhatsApp/Telegram)
- Opcional: "Gerar PDF" com html2canvas + jsPDF

---

### F14 · Comparação de ativos no DCA

**Por quê:** Investidores querem saber: "teria sido melhor DCA em BTC ou em dólar?"

**Escopo:**
- Opção de comparar DCA Bitcoin vs. guardar o equivalente em USD (sem rentabilidade)
- Opcional: comparar com CDI (dados disponíveis via API do Banco Central do Brasil)
- Gráfico de comparação lado a lado

---

### F15 · Modo "Tela de TV" (Kiosk Mode)

**Por quê:** Alguns usuários exibem o painel em TV na sala ou escritório.

**Escopo:**
- Layout full-screen sem header/footer
- Fonte maior, atualização automática visível
- Rota dedicada: `/tv`
- Sem necessidade de interação

---

## Onda 4 — Evolução de Plataforma (Longo prazo)

### F16 · Autenticação e múltiplos usuários

**Por quê:** Para funcionalidades como portfólio, alertas e preferências sincronizadas entre dispositivos.

**Abordagem:** Autenticação simples com JWT + senha hash (bcrypt). Sem OAuth externo para manter a independência.

**Impacto:** Requer migração de SQLite para PostgreSQL ou adicionar tabela `users` com isolamento de dados por `user_id`.

---

### F17 · Suporte a múltiplos ativos (ETH, SOL, etc.)

**Por quê:** Usuários de criptomoedas não investem apenas em Bitcoin.

**Escopo:**
- Configuração: lista de ativos rastreados (via `.env` ou painel de configuração)
- Widgets individuais por ativo no dashboard
- Calculadora DCA multi-ativo

**Desafio:** Manter o foco do produto. Evitar se tornar uma exchange dashboard genérica.

---

### F18 · Migração para TypeScript

**Por quê:** O código atual em JavaScript puro não tem type safety. Erros como o bug em `calculateBitcoinSupply` seriam capturados em tempo de compilação com tipos adequados.

**Escopo:**
- Migração gradual: `allowJs: true` no início
- Tipos para as respostas das APIs externas
- Tipos para as entidades do banco de dados

---

### F19 · WebSockets para atualizações em tempo real

**Por quê:** Atualmente o frontend faz polling a cada `timeUntilNextUpdate` milissegundos. Com WebSockets, o servidor empurra dados novos imediatamente após o worker completar.

**Impacto:** Melhor UX, menos requisições desnecessárias.

**Biblioteca:** `ws` ou `socket.io` no backend + listener no frontend.

---

### F20 · Métricas da Lightning Network

**Por quê:** A Lightning Network é central para a narrativa de uso do Bitcoin como meio de pagamento.

**Dados de interesse:**
- Capacidade total da rede (BTC)
- Número de canais e nós
- Taxa de crescimento

**Fonte:** Amboss.space API ou mempool.space `/api/v1/lightning/statistics/latest`

---

## Roadmap Visual

```
2026 Q2 ──► Onda 1: Testes + Docker + CI/CD + Migrations
2026 Q3 ──► Onda 2: Gráficos + Indicadores + Multi-moeda
2026 Q4 ──► Onda 3: Portfólio + Alertas + DCA melhorado
2027 Q1 ──► Onda 4: Auth + Multi-ativo + TypeScript + WebSockets
```

---

## Critérios de Priorização

Ao escolher o próximo desenvolvimento, considerar:

1. **Impacto no usuário:** quantos usuários se beneficiam?
2. **Custo de manutenção:** a feature cria dívida técnica?
3. **Compatibilidade:** quebra a experiência atual?
4. **Reversibilidade:** é fácil desfazer se não funcionar?

---

## Relacionado

- [[01-visao-geral-do-projeto]]
- [[02-melhorias-imediatas]]
