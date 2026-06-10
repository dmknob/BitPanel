module.exports = {
  apps : [{
    name        : "BitPanel", // Nome da sua aplicação no PM2
    script      : "dist/server.js",
    cwd         : __dirname,    // Mantém o diretório de trabalho correto
    watch       : false,      // Geralmente 'false' em produção para evitar reinícios acidentais
    exec_mode   : "fork",     // Confirmado como "fork"
    instances   : 1,          // 1 instância para "fork"
    env: {
      "NODE_ENV": "production"
    },
    // --- Configurações de Otimização de Memória ---
    max_memory_restart: "120M", // Reinicia se usar mais de 120MB de RAM (se o uso normal é 79.3M)
    // --- Configurações de Log (Removidas para usar o padrão do PM2) ---
    // O PM2 vai automaticamente salvar os logs em ~/.pm2/logs/BitPanel-out.log e BitPanel-error.log
    time: true                      // Adiciona timestamp aos logs (ainda útil para logs padrão)
  }]
};