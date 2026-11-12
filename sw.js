const APP_VERSION = '3.4.4';
const ASSET_REVISION = 'artwork1';
const CACHE_NAME = `ke1th-streams-v${APP_VERSION}-${ASSET_REVISION}-${self.registration.scope}`;
const APP_SHELL = [
  './',
  './index.html',
  './browse.html',
  './livetv.html',
  './watch.html',
  './media.html',
  './offline.html',
  './assets/imgs/radio/radyo-natin.png',
  './assets/imgs/radio/spirit-fm-masbate.png',
  './assets/imgs/radio/mor-radio.png',
  './assets/css/home.css',
  './assets/css/fonts.css',
  './assets/css/browse.css',
  './assets/css/livetv.css',
  './assets/css/watch.css',
  './assets/css/media.css',
  './assets/css/liquid-glass.css',
  './assets/css/landscape.css',
  './assets/js/config.js',
  './assets/js/image-manifest.js',
  './assets/js/images.js',
  './assets/js/tmdb.js',
  './assets/js/home.js',
  './assets/js/browse.js',
  './assets/js/livetv.js',
  './assets/js/live-recovery.js',
  './assets/js/watch-history.js',
  './assets/js/watch.js',
  './assets/js/media.js',
  './assets/js/search.js',
  './assets/js/liquid-glass.js',
  './assets/js/landscape.js',
  './assets/vendor/mobile-dock.min.js',
  './assets/vendor/shaka/controls.css',
  './assets/vendor/shaka/shaka-player.ui.js',
  './assets/vendor/shaka/mux.min.js',
  './assets/fonts/inter-6.woff2',
  './assets/fonts/roboto-regular.ttf',
  './assets/fonts/material-icons-round.otf'
];

const APP_SHELL_URLS = APP_SHELL.map(path => {
  const url = new URL(path, self.registration.scope);
  if (/\.(?:css|js)$/.test(url.pathname)) {
    url.searchParams.set('v', APP_VERSION);
    url.searchParams.set('rev', ASSET_REVISION);
  }
  return url;
});
const VERSIONED_ASSETS = new Set(APP_SHELL_URLS.filter(url => url.search).map(url => url.href));

self.addEventListener('install', event => {
  const requests = APP_SHELL_URLS.map(url => new Request(url, { cache: 'reload' }));
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(requests))
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
  const isArtwork = /\/assets\/imgs\/.*\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/i.test(url.pathname)
    || /\/api\/images\/?$/.test(url.pathname);
  const isImageResponse = response => response?.status === 200 &&
    /^image\//i.test(response.headers.get('Content-Type') || '');

  // Newly discovered titles use the official image CDN on static hosting.
  // Cache only real images, so an HTML error page cannot poison a poster URL.
  if (url.origin === 'https://image.tmdb.org' && /^\/t\/p\/(?:w200|w500|w1280)\/[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME).catch(() => null);
      const cached = await cache?.match(event.request).catch(() => undefined);
      if (isImageResponse(cached)) return cached;
      if (cached) await cache?.delete(event.request).catch(() => {});
      const response = await fetch(event.request);
      if (isImageResponse(response)) await cache?.put(event.request, response.clone()).catch(() => {});
      return response;
    })().catch(() => Response.error()));
    return;
  }
  
  if (url.origin === self.location.origin) {
    const refresh = isNavigate || /\.(?:css|js|html)$/.test(url.pathname);
    const cache = caches.open(CACHE_NAME).catch(() => null);
    const readCached = async request => {
      const store = await cache;
      const response = await store?.match(request).catch(() => undefined);
      if (response && isArtwork && !isImageResponse(response)) {
        await store?.delete(request).catch(() => {});
        return undefined;
      }
      return response;
    };
    const fetchAndCache = () => fetch(event.request, refresh ? { cache: 'no-cache' } : undefined).then(async response => {
      const result = isNavigate && response.redirected ? await cleanResponse(response) : response;
      if (result.status === 200 && (!isArtwork || isImageResponse(result))) {
        // A storage failure must not turn a successful request into an offline page.
        await (await cache)?.put(event.request, result.clone()).catch(() => {});
      }
      return result;
    });

    // The current release was fetched during installation with HTTP caching
    // bypassed. Only fetch these exact asset URLs again on a cache miss.
    if (!isNavigate && VERSIONED_ASSETS.has(url.href)) {
      event.respondWith(readCached(event.request)
        .then(cached => cached || fetchAndCache())
        .catch(() => Response.error()));
      return;
    }

    // Bundled images/fonts and cached artwork have immutable names. A cache hit
    // must not start another download while the user scrolls through the catalog.
    if (/\/assets\/(?:imgs|fonts)\//.test(url.pathname) || /\/api\/images\/?$/.test(url.pathname)) {
      event.respondWith(readCached(event.request).then(cached => cached || fetchAndCache()).catch(() => Response.error()));
      return;
    }

    // Documents and assets from other revisions still revalidate online.
    const network = fetchAndCache();
    if (refresh) {
      event.respondWith(network.catch(async () => {
        const cached = await readCached(event.request);
        if (cached) return isNavigate && cached.redirected ? cleanResponse(cached) : cached;
        if (isNavigate) {
          const offlinePage = await readCached(new URL('offline.html', self.registration.scope));
          if (offlinePage) return offlinePage;
        }
        return Response.error();
      }));
    } else {
      event.respondWith(readCached(event.request).then(cached => cached || network));
      event.waitUntil(network.catch(() => {}));
    }
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


