#!/usr/bin/env node
'use strict';

const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();

console.log('\nVAPID Keys geradas com sucesso!\n');
console.log('Adicione as linhas abaixo ao seu arquivo .env:\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_CONTACT_EMAIL=admin@seudominio.com\n`);
console.log('IMPORTANTE: Guarde a chave privada em segurança. Nunca compartilhe VAPID_PRIVATE_KEY.');
console.log('Se você regenerar as chaves, todos os usuários precisarão reativar os alertas.\n');
