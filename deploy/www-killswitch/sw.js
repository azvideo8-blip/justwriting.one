// Служебный работник-выключатель для адреса www.
//
// На www когда-то был зарегистрирован обычный служебный работник, и он
// продолжает отдавать закэшированную сборку, не давая браузеру уйти на
// канонический адрес. Обновиться он может только через свой sw.js — поэтому по
// этому пути отдаётся вот это: снимает себя с регистрации, чистит кэши и
// перезагружает открытые вкладки, после чего 301 на основной домен наконец
// срабатывает.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) client.navigate(client.url);
  })());
});
