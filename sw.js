const CACHE_NAME = 'taskflow-v2';

// 1. Install and immediately take over
self.addEventListener('install', (event) => {
    self.skipWaiting();
    console.log('Service Worker Installed');
});

// 2. Activate and DESTROY the old stuck caches!
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('🗑️ Deleting old stuck cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// 3. NETWORK FIRST: Always get fresh code from Vercel, only use cache if offline!
self.addEventListener('fetch', (event) => {
    // We only care about GET requests
    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request).then((networkResponse) => {
            // If we get a good response from Vercel, save a fresh copy to the cache
            return caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, networkResponse.clone());
                return networkResponse;
            });
        }).catch(() => {
            // If the network fails (you are offline), pull from the cache
            return caches.match(event.request);
        })
    );
});
