// DT-4 (подозрение дейлика 02.11): навигационный кэш `public/sw.js` рос без потолка —
// каждая новая страница (`/note/<uuid>`, `/diary`, …) добавляет запись в `jw-nav-<версия>`,
// и записей становилось сколько угодно за одну версию воркера. Тест поднимает настоящий
// `public/sw.js` с подменённым миром (тот же приём, что в serviceWorkerOfflineFallback.test.ts)
// и считает записи после множества навигаций; вторая часть — что офлайн-откройка
// свежей страницы от потолка не страдает.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const SW_SRC = readFileSync(resolve('public/sw.js'), 'utf8');
const ORIGIN = 'https://justwriting.ru';

/** Потолок навигационного кэша, который обязан держать воркер. */
const NAV_CACHE_MAX = 12;

interface Entry { url: string; text: string }

function boot() {
  const listeners: Record<string, (event: unknown) => void> = {};
  const fakeSelf = {
    addEventListener: (type: string, cb: (event: unknown) => void) => { listeners[type] = cb; },
    location: { origin: ORIGIN },
    clients: { claim: () => undefined },
    skipWaiting: () => undefined,
  };

  const entries: Entry[] = [];
  let online = true;

  const navCache = {
    match: async (req: { url: string }) => {
      const hit = entries.find(e => e.url === req.url);
      return hit ? new Response(hit.text, { status: 200, headers: { 'Content-Type': 'text/html' } }) : undefined;
    },
    put: async (req: { url: string }, res: Response) => {
      const i = entries.findIndex(e => e.url === req.url);
      if (i >= 0) entries.splice(i, 1);
      entries.push({ url: req.url, text: await res.clone().text() });
    },
    keys: async () => entries.map(e => ({ url: e.url })),
    delete: async (key: { url: string }) => {
      const i = entries.findIndex(e => e.url === key.url);
      if (i >= 0) entries.splice(i, 1);
      return i >= 0;
    },
  };
  const assetCache = { match: async () => undefined, put: async () => undefined, add: async () => undefined, keys: async () => [], delete: async () => true };

  const caches = {
    open: async (name: string) => (name.startsWith('jw-nav-') ? navCache : assetCache),
    match: async () => undefined,
    keys: async () => [],
    delete: async () => true,
  };

  const fetchImpl = async (req: { url?: string }) => {
    if (!online) throw new TypeError('Failed to fetch');
    const url = typeof req === 'string' ? req : req.url ?? '';
    return new Response(`страница ${url}`, { status: 200, headers: { 'Content-Type': 'text/html' } });
  };

  const run = new Function('self', 'caches', 'fetch', 'URL', SW_SRC) as (
    self: unknown, caches: unknown, fetch: unknown, URL: unknown
  ) => void;
  run(fakeSelf, caches, fetchImpl, URL);
  const onFetch = listeners.fetch;
  expect(onFetch, 'воркер не подписал обработчик fetch').toBeTruthy();

  return {
    size: () => entries.length,
    goOffline: () => { online = false; },
    async dispatch(target: string) {
      let captured: Promise<Response> | undefined;
      onFetch!({
        request: {
          url: `${ORIGIN}${target}`, mode: 'navigate', destination: 'document', method: 'GET',
          clone() { return this; },
        },
        respondWith: (response: Promise<Response>) => { captured = response; },
      });
      const response = await captured!;
      // Записи в кэш кладутся асинхронно (`void … .then`), дождься их.
      await new Promise(r => setTimeout(r, 0));
      await new Promise(r => setTimeout(r, 0));
      return response;
    },
  };
}

describe('DT-4: навигационный кэш воркера под потолком', () => {
  it(`${NAV_CACHE_MAX * 3} разных навигаций не оставляют больше ${NAV_CACHE_MAX} записей`, async () => {
    const worker = boot();
    for (let i = 0; i < NAV_CACHE_MAX * 3; i++) await worker.dispatch(`/note/n${i}`);
    expect(worker.size()).toBeLessThanOrEqual(NAV_CACHE_MAX);
  });

  it('переоткрытие офлайн отдаёт свежую записанную страницу, а не заглушку', async () => {
    const worker = boot();
    for (let i = 0; i < NAV_CACHE_MAX * 3; i++) await worker.dispatch(`/note/n${i}`);
    worker.goOffline();
    const last = await worker.dispatch(`/note/n${NAV_CACHE_MAX * 3 - 1}`);
    expect(await last.text()).toBe(`страница ${ORIGIN}/note/n${NAV_CACHE_MAX * 3 - 1}`);
  });
});
