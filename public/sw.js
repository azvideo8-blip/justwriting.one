const CACHE_VERSION = 'v0.11.0';
const CACHE = `jw-${CACHE_VERSION}`;
const NAV_CACHE = `jw-nav-${CACHE_VERSION}`;

// SB-6: `caches.match` при пустом кэше резолвится в undefined, а
// `respondWith(undefined)` — не «страница ошибки по вкусу», а сетевая ошибка по
// спецификации: человек видит системную заглушку браузера без единой подсказки,
// что его записи на месте. Статус 200, а не 503: на стенде (офлайн, пустой кэш)
// синтетический 503 для навигации Chrome тоже оформляет как свою страницу
// ошибки — текст видно, но адрес в строке при этом теряется.
const OFFLINE_HTML = '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>Нет сети</title></head><body>' +
  '<h1>Нет сети</h1>' +
  '<p>Не удалось загрузить приложение. Записи, сохранённые на этом устройстве, на месте — ' +
  'откройте страницу заново, когда связь вернётся.</p>' +
  '</body></html>';

function offlineResponse() {
  return new Response(OFFLINE_HTML, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// Офлайн-навигация: сначала записанная страница, затем оболочка из кэша
// установки, и только потом заглушка. Дно — ответ всегда: промах по кэшу — это
// «мы не знаем», а не «показывать нечего».
async function offlineNavigation(request) {
  try {
    const cache = await caches.open(NAV_CACHE);
    return (await cache.match(request)) || (await caches.match('/index.html')) || offlineResponse();
  } catch {
    // Приватный режим и переполненная квота: кэш-хранилище не открылось.
    return offlineResponse();
  }
}

self.addEventListener('install', (event) => {
  // DA-19: addAll — всё или ничего: один сбойный запрос ронял установку, и новый
  // воркер так и не вставал. Оболочка — лишь запасной вариант офлайн (навигация
  // идёт в сеть первой), поэтому кладём её по возможности.
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.allSettled(['/', '/index.html'].map((u) => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      // R4-066: снести можно только свои кэши (префикс jw-), а не чужие
      // записи Cache Storage, оставшиеся от других приложений на origin.
      Promise.all(keys.filter((k) => k.startsWith('jw-') && k !== CACHE && k !== NAV_CACHE).map((k) => caches.delete(k)))
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
      }).catch(() => offlineNavigation(event.request))
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
        // SB-6: промах по кэшу плюс отказ сети — это Response.error() (честная
        // сетевая ошибка), а не undefined, попавший в respondWith.
        }).catch(() => cached || Response.error())
      )
    );
    return;
  }
});
