# DEPLOYMENT.md: Guia de Implantação do BitPanel

Este documento detalha os passos necessários para implantar e configurar o BitPanel em um novo ambiente de servidor Linux (Ubuntu/Debian).

## Sumário
1.  [Pré-requisitos do Servidor](#1-pré-requisitos-do-servidor)
2.  [Obtenção do Código-Fonte](#2-obtenção-do-código-fonte)
3.  [Variáveis de Ambiente (`.env`)](#3-variáveis-de-ambiente-env)
4.  [Instalação de Dependências](#4-instalação-de-dependências)
5.  [Configuração do Serviço com PM2](#5-configuração-do-serviço-com-pm2)
6.  [Configuração do Proxy Reverso com Nginx](#6-configuração-do-proxy-reverso-com-nginx)
7.  [Configuração do Backup Automático do Banco de Dados](#7-configuração-do-backup-automático-do-banco-de-dados)
8.  [Monitoramento](#8-monitoramento)
9.  [Considerações de Segurança](#9-considerações-de-segurança)
10. [Restaurando um Backup](#10-restaurando-um-backup)

---

## 1. Pré-requisitos do Servidor

Certifique-se de que o servidor possui os seguintes softwares instalados:

* **Node.js e npm:** Versão LTS recomendada.
    ```bash
    # Exemplo para Ubuntu/Debian:
    sudo apt update
    sudo apt install -y curl
    curl -fsSL [https://deb.nodesource.com/setup_lts.x](https://deb.nodesource.com/setup_lts.x) | sudo -E bash -
    sudo apt install -y nodejs
    ```
* **Git:** Para clonar o repositório.
    ```bash
    sudo apt install -y git
    ```
* **PM2:** Gerenciador de processos Node.js.
    ```bash
    sudo npm install -g pm2
    ```
* **SQLite3 CLI:** Ferramenta de linha de comando para o banco de dados.
    ```bash
    sudo apt install -y sqlite3
    ```
* **Nginx:** Servidor web/proxy reverso.
    ```bash
    sudo apt install -y nginx
    ```

---

## 2. Obtenção do Código-Fonte

Clone o repositório **BitPanel** para o **diretório de sua escolha** no servidor (ex: `/var/www/BitPanel/`, `/srv/BitPanel/`). Este diretório se tornará a **raiz do projeto BitPanel**.

```bash
# Exemplo de clonagem para /var/www/BitPanel/
sudo mkdir -p /var/www/BitPanel # Cria o diretório pai, se necessário
sudo chown seu_usuario:seu_usuario /var/www/BitPanel # Garanta que seu usuário tenha permissão
cd /var/www/BitPanel # Navegue até a raiz do projeto
git clone [https://github.com/dmknob/BitPanel.git](https://github.com/dmknob/BitPanel.git) . # Clona o repositório diretamente para a pasta atual (BitPanel)
```

**Nota:** Substitua `seu_usuario` pelo nome de usuário que executará o aplicativo. Para todos os comandos subsequentes, assume-se que você está na **raiz do diretório do projeto BitPanel** (ex: `/var/www/BitPanel/`).

---

## 3. Variáveis de Ambiente (`.env`)

Após clonar o repositório, crie o arquivo `.env` na **raiz do diretório do projeto BitPanel**. Este arquivo carrega variáveis de ambiente sensíveis e de configuração.

**Localização:** `/caminho/absoluto/do/seu/projeto/BitPanel/.env`

**Variáveis Necessárias:**

* `PORT`: Porta na qual o servidor Express irá escutar (ex: `3000`).
* `DB_NAME`: Nome do arquivo do banco de dados SQLite (ex: `bitpanel.sqlite`).
* `UPDATE_INTERVAL_SECONDS`: Frequência de atualização dos dados em segundos (ex: `300` para 5 minutos).
* `COINGECKO_API_KEY`: Sua chave de API da CoinGecko. **Esta chave é sensível e não deve ser versionada no Git.**
* `COINGECKO_API_KEY_2` *(opcional)*: Segunda chave de API da CoinGecko. Quando presente, o servidor alterna automaticamente entre as duas chaves para dividir o consumo mensal e evitar atingir o limite de 10.000 chamadas/mês do plano gratuito. Se uma chave receber HTTP 429 (rate limit) ou 403, o servidor tenta automaticamente com a outra.

**Exemplo de `.env`:**

```
PORT=3000
DB_NAME=bitpanel.sqlite
UPDATE_INTERVAL_SECONDS=300
COINGECKO_API_KEY=SUA_CHAVE_DE_API_DA_COINGECKO_AQUI
COINGECKO_API_KEY_2=SUA_SEGUNDA_CHAVE_DA_COINGECKO_AQUI
```

**⚠️ Atenção:** Substitua `SUA_CHAVE_DE_API_DA_COINGECKO_AQUI` e `SUA_SEGUNDA_CHAVE_DA_COINGECKO_AQUI` pelas suas chaves reais. A segunda chave é opcional — se omitida, o servidor funciona normalmente com apenas uma chave.

---

## 4. Instalação de Dependências

Navegue até a raiz do diretório do projeto (`BitPanel/`) e instale as dependências do Node.js:

```bash
cd /caminho/absoluto/do/seu/projeto/BitPanel/ # Ex: /var/www/BitPanel/
npm install
```

---

## 5. Configuração do Serviço com PM2

O PM2 é usado para manter o aplicativo Node.js rodando em segundo plano e reiniciá-lo automaticamente em caso de falha. **Execute estes comandos a partir da raiz do diretório do projeto BitPanel.**

```bash
cd /caminho/absoluto/do/seu/projeto/BitPanel/ # Ex: /var/www/BitPanel/
pm2 start ecosystem.config.js
pm2 save # Salva a configuração atual para que o PM2 reinicie com o sistema
pm2 startup # Gera o comando para PM2 iniciar automaticamente no boot do sistema (execute o comando fornecido)
```

*(Após `pm2 startup`, você receberá um comando para colar e executar, que garante a inicialização do PM2 com o sistema.)*

---

## 6. Configuração do Proxy Reverso com Nginx

Para servir o BitPanel via Nginx e permitir acesso através das portas HTTP (80) e HTTPS (443), configuraremos um proxy reverso.

1.  **Crie um arquivo de configuração para o seu site no Nginx:**
    ```bash
    sudo nano /etc/nginx/sites-available/bitpanel
    ```

2.  **Adicione a seguinte configuração (substitua `seusite.com` pelo seu domínio):**

    ```nginx
    server {
        listen 80;
        listen [::]:80;
        server_name seusite.com [www.seusite.com](https://www.seusite.com); # Substitua pelo seu domínio

        location / {
            proxy_pass http://localhost:3000; # Use a porta definida no seu .env para o BitPanel
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
        }
    }
    ```
    **⚠️ Importante:** O `proxy_pass` deve apontar para `http://localhost:PORTA_DO_BITPANEL`, onde `PORTA_DO_BITPANEL` é o valor definido em `PORT` no seu `.env`.

3.  **Ative a configuração criando um link simbólico:**
    ```bash
    sudo ln -s /etc/nginx/sites-available/bitpanel /etc/nginx/sites-enabled/
    ```

4.  **Teste a configuração do Nginx e reinicie:**
    ```bash
    sudo nginx -t
    sudo systemctl restart nginx
    ```

5.  **Configuração HTTPS (Recomendado com Certbot):**
    * Para HTTPS, é altamente recomendado usar o Certbot. Siga as instruções oficiais do Certbot para Nginx para obter um certificado Let's Encrypt gratuito.
    * Exemplo de instalação e uso (adapte para seu OS e domínio):
    ```bash
    sudo apt install certbot
    sudo certbot --nginx -d seusite.com -d [www.seusite.com](https://www.seusite.com) # Substitua pelo seu domínio
    ```
    * O Certbot irá automaticamente ajustar sua configuração do Nginx para HTTPS e configurar a renovação automática do certificado.

---

## 7. Configuração do Backup Automático do Banco de Dados

Um script Bash lida com o backup diário do banco de dados SQLite e com a política de retenção.

**Política de Retenção:**

* **Diário:** Mantém os últimos 7 dias de backups.
* **Semanal:** Mantém as últimas 5 quintas-feiras de backups.
* **Mensal:** Mantém o backup do dia 05 dos últimos 6 meses.
* **Horário de Execução:** Diariamente às 03:15 AM (horário do servidor).

**Passos:**

1.  **Tornar o Script Executável:**

    * O script de backup precisa de permissão de execução. **Execute este comando a partir da raiz do diretório do projeto BitPanel.**
        ```bash
        cd /caminho/absoluto/do/seu/projeto/BitPanel/ # Ex: /var/www/BitPanel/
        chmod +x scripts/backup_bitpanel_db.sh
        ```

2.  **Configurar o Crontab:**

    * Abra o editor do crontab para o usuário que executa o BitPanel:
        ```bash
        crontab -e
        ```
    * Adicione a seguinte linha no final do arquivo. **É fundamental que você substitua `/caminho/absoluto/do/seu/projeto/BitPanel/` pelo local exato onde você clonou o projeto.**
        ```crontab
        15 3 * * * /bin/bash -lc "/caminho/absoluto/do/seu/projeto/BitPanel/scripts/backup_bitpanel_db.sh" >> "/caminho/absoluto/do/seu/projeto/BitPanel/cron_backup_log.log" 2>&1
        ```
    * Salve e saia do editor (Ex: `Ctrl+X`, `Y`, `Enter` para `nano`).

---

## 8. Monitoramento

* **Logs do Aplicativo (PM2):**
    ```bash
    pm2 logs bitpanel.com.br
    ```
* **Logs do Backup (Crontab):**
    * O log do backup será criado na raiz do diretório do projeto.
    ```bash
    tail -f /caminho/absoluto/do/seu/projeto/BitPanel/cron_backup_log.log # Ex: /var/www/BitPanel/cron_backup_log.log
    ```
* **Logs do Nginx:**
    ```bash
    tail -f /var/log/nginx/access.log
    tail -f /var/log/nginx/error.log
    ```

---

## 9. Considerações de Segurança

* **Firewall (`ufw`):** Configure um firewall (ex: `ufw`) para permitir apenas o tráfego necessário. **Não exponha a porta direta do Node.js (definida em `PORT` no `.env`) publicamente.**
    * Permitir SSH: `sudo ufw allow ssh`
    * Permitir HTTP (Nginx): `sudo ufw allow http`
    * Permitir HTTPS (Nginx): `sudo ufw allow https`
    * Ativar UFW: `sudo ufw enable`
    * Verificar status: `sudo ufw status`
* **Permissões:** Garanta que os arquivos e diretórios do projeto tenham as permissões corretas (o usuário do serviço deve ter acesso, mas evite permissões excessivas).
* **Atualizações:** Mantenha o sistema operacional, as dependências do Node.js e o Nginx atualizados.
* **SSL/TLS:** Sempre use HTTPS em produção para criptografar o tráfego.

---

## 10. Restaurando um Backup

Em caso de necessidade de restaurar o banco de dados:

1.  **Pare o serviço do BitPanel:** **Execute este comando a partir da raiz do diretório do projeto.**
    ```bash
    cd /caminho/absoluto/do/seu/projeto/BitPanel/ # Ex: /var/www/BitPanel/
    pm2 stop bitpanel.com.br
    ```
2.  **Identifique o Backup:**
    * Navegue até o diretório de backups (que será criado em `~/backups/BitPanel_db/` em relação ao `HOME` do usuário que executa o script).
    * Exemplo de caminho: `/home/seu_usuario/backups/BitPanel_db/`.
    * Escolha o arquivo `.bak` que deseja restaurar.
3.  **Restaure o Banco de Dados:**
    * **Faça um backup do banco de dados ATUAL (mesmo que corrompido) antes de restaurar, para ter um ponto de recuperação caso o novo backup também seja problemático.**
    * **Execute estes comandos a partir da raiz do diretório do projeto.**
    ```bash
    cd /caminho/absoluto/do/seu/projeto/BitPanel/ # Ex: /var/www/BitPanel/
    mv bitpanel.sqlite bitpanel.sqlite.corrupted_$(date +%Y%m%d%H%M%S)
    cp ~/backups/BitPanel_db/SEU_ARQUIVO_DE_BACKUP.bak bitpanel.sqlite
    ```
    * **Importante:** Substitua `SEU_ARQUIVO_DE_BACKUP.bak` pelo nome real do arquivo.
    * **Atenção:** O caminho `~/backups/BitPanel_db/` é relativo ao HOME do usuário que executa o script. Ajuste se o diretório de backups foi configurado de forma diferente.
4.  **Inicie o serviço do BitPanel:** **Execute este comando a partir da raiz do diretório do projeto.**
    ```bash
    cd /caminho/absoluto/do/seu/projeto/BitPanel/ # Ex: /var/www/BitPanel/
    pm2 start bitpanel.com.br
    ```