const CACHE_NAME = 'ke1th-streams-v3.1.6';
const APP_SHELL = [
  '/',
  '/index.html',
  '/browse.html',
  '/livetv.html',
  '/watch.html',
  '/media.html',
  '/offline.html',
  '/assets/css/home.css',
  '/assets/css/browse.css',
  '/assets/css/livetv.css',
  '/assets/css/watch.css',
  '/assets/css/media.css',
  '/assets/css/liquid-glass.css',
  '/assets/js/config.js',
  '/assets/js/tmdb.js',
  '/assets/js/home.js',
  '/assets/js/browse.js',
  '/assets/js/livetv.js',
  '/assets/js/watch.js',
  '/assets/js/media.js',
  '/assets/js/search.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  
  const url = new URL(event.request.url);
  
  // Only use stale-while-revalidate for our own domain assets to ensure instant loading
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const fetchPromise = fetch(event.request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const cacheCopy = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, cacheCopy));
          }
          
          // FIX FOR SAFARI: "Response served by service worker has redirections"
          if (networkResponse && networkResponse.redirected && event.request.mode === 'navigate') {
              return Response.redirect(networkResponse.url, 302);
          }
          
          return networkResponse;
        }).catch(async () => {
           // Network failure
           if (!cached && event.request.mode === 'navigate') {
              return caches.match('/offline.html');
           }
        });
        
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Default network-first fallback for external API calls/images
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(event.request);
      return cached || new Response('', { status: 503, statusText: 'Service Unavailable' });
    })
  );
});
