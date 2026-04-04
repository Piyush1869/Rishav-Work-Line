const CACHE_NAME = 'lab-manager-v1';

// Install the service worker
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(['/', '/index.html', '/style.css', '/app.js']);
        })
    );
    console.log('Service Worker Installed');
});

// The crucial Fetch event that Chrome looks for
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});
