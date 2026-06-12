const CACHE_NAME = 'ke1th-streams-v3.1.9';
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
  
  // Only use stale-while-revalidate for our own domain assets
  if (url.origin === self.location.origin) {
    event.respondWith(
      (async function() {
        let cachedResponse = await caches.match(event.request);
        
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
            const cache = await caches.open(CACHE_NAME);
            cache.put(event.request, responseToCache.clone());
          }
          
          return responseToReturn;
        }).catch(async (error) => {
           // Fallback to offline page if network fails and no cache exists
           if (!cachedResponse && isNavigate) {
              const offlinePage = await caches.match('/offline.html');
              if (offlinePage) return offlinePage;
           }
           throw error;
        });
        
        // Keep the SW alive until the background fetch finishes
        event.waitUntil(networkPromise.catch(() => {}));
        
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
         throw error;
       }
    })()
  );
});
