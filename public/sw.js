/* eslint-env worker */
const CACHE_VERSION = 'v0.7.48';
const CACHE = `jw-${CACHE_VERSION}`;
const NAV_CACHE = `jw-nav-${CACHE_VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(['/', '/index.html'])
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE && k !== NAV_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) return;

  // Bypass non-GET requests and API calls to prevent fetch errors and stream truncation
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  // Navigation: network-first so a deploy is picked up immediately. The cached
  // shell is only a fallback when offline — never serve a stale index.html that
  // points at old, already-purged asset bundles (that broke clients on the
  // IndexedDB v6 bump: old shell -> old JS -> could not open the upgraded DB).
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          void caches.open(NAV_CACHE).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() =>
        caches.open(NAV_CACHE).then((cache) =>
          cache.match(event.request).then((cached) => cached || caches.match('/index.html'))
        )
      )
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cached) =>
        cached || fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            void caches.open(CACHE).then((c) => c.put(event.request, clone));
          }
          return response;
        }).catch(() => cached)
      )
    );
    return;
  }
});
