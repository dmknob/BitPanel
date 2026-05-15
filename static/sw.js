const CACHE_NAME = 'bitpanel-cache-v4';
const urlsToCache = [
    '/',
    '/dca',
    '/tv',
    '/style.css',
    '/js/common.js',
    '/js/dashboard.js',
    '/js/dca.js',
    '/js/tv.js',
    '/images/icon-192x192.png',
    '/images/icon-512x512.png',
];

// Evento de Instalação: Salva o App Shell no cache
self.addEventListener('install', event => {
    console.log('Service Worker: Instalando...');
    // Força o Service Worker a ativar imediatamente após a instalação, ignorando o estado de espera.
    self.skipWaiting(); 
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Service Worker: Cache aberto e App Shell adicionado');
                return cache.addAll(urlsToCache);
            })
            .catch(error => {
                console.error('Service Worker: Falha na instalação ou no cache.addAll:', error);
            })
    );
});

// Evento de Ativação: Limpa caches antigos e assume controle
self.addEventListener('activate', event => {
    console.log('Service Worker: Ativando...');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Service Worker: Removendo cache antigo', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            // Garante que o Service Worker assume o controle da página imediatamente
            return self.clients.claim();
        })
    );
});

// Listener para mensagens do Service Worker (para SKIP_WAITING no activate)
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        console.log('Service Worker: Recebeu SKIP_WAITING, pulando espera.');
        self.skipWaiting();
    }
});


// Evento de Push: Exibe notificação quando o servidor envia um alerta de preço
self.addEventListener('push', event => {
    if (!event.data) return;
    let payload;
    try {
        payload = event.data.json();
    } catch {
        payload = { title: 'BitPanel', body: event.data.text() };
    }
    event.waitUntil(
        self.registration.showNotification(payload.title || 'BitPanel', {
            body: payload.body || '',
            icon: payload.icon || '/images/icon-192x192.png',
            badge: payload.badge || '/images/icon-192x192.png',
            data: { url: payload.url || '/' },
        })
    );
});

// Evento de clique na notificação: abre o painel
self.addEventListener('notificationclick', event => {
    event.notification.close();
    const url = event.notification.data?.url || '/';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            for (const client of windowClients) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    return client.focus();
                }
            }
            return clients.openWindow(url);
        })
    );
});

// Evento de Fetch: Intercepta as requisições para aplicar estratégias de cache
self.addEventListener('fetch', event => {
    // 1. Estratégia para Requisições de API (Network Only, sem cache no SW, apenas frontend)
    if (event.request.url.includes('/api/')) {
        event.respondWith(
            fetch(event.request).catch(error => {
                console.error('Service Worker: Falha ao buscar API (offline ou erro de rede):', event.request.url, error);
                // Não há fallback no SW aqui, a lógica de erro/offline deve ser no frontend
                // Ou você pode retornar uma resposta de erro genérica:
                // return new Response(JSON.stringify({ error: 'Offline' }), { headers: { 'Content-Type': 'application/json' }, status: 503 });
            })
        );
        return;
    }

    // 2. Estratégia para Assets Estáticos (CSS, JS, Imagens, HTML do App Shell): Stale-While-Revalidate
    const isAppShellAsset = urlsToCache.some(url => event.request.url.includes(url.replace(/^\//, '')) || event.request.url === self.location.origin + url);

    if (isAppShellAsset) {
        event.respondWith(
            caches.open(CACHE_NAME).then(cache => {
                return cache.match(event.request).then(response => {
                    const fetchPromise = fetch(event.request).then(networkResponse => {
                        cache.put(event.request, networkResponse.clone());
                        return networkResponse;
                    }).catch(error => {
                        console.warn('Service Worker: Falha ao revalidar asset da rede:', event.request.url, error);
                    });
                    
                    return response || fetchPromise;
                });
            })
        );
        return;
    }

    // 3. Estratégia padrão para outros recursos: Network First, then Cache
    event.respondWith(
        fetch(event.request).catch(() => {
            return caches.match(event.request);
        })
    );
});