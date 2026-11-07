const CACHE_NAME = 'ke1th-streams-v3.4.2-' + self.registration.scope;
const APP_SHELL = [
  './',
  './index.html',
  './browse.html',
  './livetv.html',
  './watch.html',
  './media.html',
  './offline.html',
  './assets/css/home.css?v=3.4.2',
  './assets/css/browse.css?v=3.4.2',
  './assets/css/livetv.css?v=3.4.2',
  './assets/css/watch.css?v=3.4.2',
  './assets/css/media.css?v=3.4.2',
  './assets/css/liquid-glass.css?v=3.4.2',
  './assets/css/landscape.css?v=3.4.2',
  './assets/js/config.js?v=3.4.2',
  './assets/js/tmdb.js?v=3.4.2',
  './assets/js/home.js?v=3.4.2',
  './assets/js/browse.js?v=3.4.2',
  './assets/js/livetv.js?v=3.4.2',
  './assets/js/watch-history.js?v=3.4.2',
  './assets/js/watch.js?v=3.4.2',
  './assets/js/media.js?v=3.4.2',
  './assets/js/search.js?v=3.4.2',
  './assets/js/liquid-glass.js?v=3.4.2',
  './assets/js/landscape.js?v=3.4.2',
  './assets/vendor/mobile-dock.min.js?v=3.4.2'
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
          if (cacheName !== CACHE_NAME && cacheName.startsWith('ke1th-streams-') &&
            (cacheName.endsWith(self.registration.scope) ||
              (new URL(self.registration.scope).pathname === '/' && /^ke1th-streams-v\d+\.\d+\.\d+$/.test(cacheName)))) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => clients.claim())
  );
});

// Deep-clean the response to completely strip the 'redirected' flag in Safari
async function cleanResponse(response) {
  const clonedResponse = response.clone();
  // Reading to a blob is required to sever ties to the redirected stream in WebKit
  const bodyBlob = await clonedResponse.blob();
  
  // Construct headers manually
  const headers = new Headers();
  for (const [key, value] of clonedResponse.headers.entries()) {
    headers.append(key, value);
  }
  
  return new Response(bodyBlob, {
    status: clonedResponse.status,
    statusText: clonedResponse.statusText,
    headers: headers
  });
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  
  // Bugfix for Chrome 'only-if-cached' error
  if (event.request.cache === 'only-if-cached' && event.request.mode !== 'same-origin') {
    return;
  }
  
  const url = new URL(event.request.url);
  const isNavigate = event.request.mode === 'navigate';
  
  // Refresh page navigations immediately and revalidate assets in the background.
  if (url.origin === self.location.origin) {
    event.respondWith(
      (async function() {
        const cache = await caches.open(CACHE_NAME);
        let cachedResponse = await cache.match(event.request);
        
        // If the cached response is tainted with redirections, Safari will crash. Clean it!
        if (cachedResponse && cachedResponse.redirected && isNavigate) {
           cachedResponse = await cleanResponse(cachedResponse);
        }
        
        // Fetch fresh version in the background
        const networkPromise = fetch(event.request).then(async networkResponse => {
          let responseToCache = networkResponse;
          let responseToReturn = networkResponse;
          
          // Clean the network response before caching and returning if it's redirected
          if (networkResponse && networkResponse.redirected && isNavigate) {
             responseToCache = await cleanResponse(networkResponse);
             responseToReturn = responseToCache.clone();
          }
          
          if (responseToCache && responseToCache.status === 200) {
            await cache.put(event.request, responseToCache.clone());
          }
          
          return responseToReturn;
        }).catch(async (error) => {
           // Fallback to offline page if network fails and no cache exists
           if (!cachedResponse && isNavigate) {
              const offlinePage = await cache.match(new URL('offline.html', self.registration.scope));
              if (offlinePage) return offlinePage;
           }
           throw error;
        });
        
        // Keep the SW alive until the background fetch finishes
        event.waitUntil(networkPromise.catch(() => {}));
        
        if (isNavigate) return networkPromise.catch(() => cachedResponse || Response.error());
        return cachedResponse || networkPromise;
      })()
    );
    return;
  }

  // Default network-first fallback for external API calls/images
  event.respondWith(
    (async function() {
       try {
         const networkResponse = await fetch(event.request);
         return networkResponse;
       } catch (error) {
         const cached = await caches.match(event.request);
         if (cached) return cached;
         // Return an empty 408 Request Timeout instead of throwing to prevent console spam
         return new Response('', { status: 408, statusText: 'Request Timeout' });
       }
    })()
  );
});


