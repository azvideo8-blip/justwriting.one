import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * SB-6 (`sync-failure-modes/03`): офлайн-фолбэк навигации построен на цепочке
 * `cached || caches.match('/index.html')`, а `caches.match` при пустом кэше
 * резолвится в `undefined` — то есть в `respondWith` приходит обещанное
 * `undefined`. Это не «показать страницу ошибки»: по спецификации такой fetch
 * завершается сетевой ошибкой, и в консоли остаётся «unsupported response
 * type», а человек видит системную заглушку браузера без единой подсказки, что
 * его записи никуда не делись. Стенд поднимает настоящий `public/sw.js` с
 * подменёнными `caches`/`fetch` и смотрит, что именно получает `respondWith`.
 */

const SW_SRC = readFileSync(resolve('public/sw.js'), 'utf8');
const ORIGIN = 'https://justwriting.ru';

interface FakeCache {
  match: (req: unknown) => Promise<Response | undefined>;
  put: (req: unknown, res: unknown) => Promise<void>;
  add: (url: unknown) => Promise<void>;
}

interface StandOptions {
  /** Ответ `cache.match(event.request)` внутри NAV_CACHE. */
  navMatch?: Response;
  /** Ответ `caches.match('/index.html')` — оболочка из установочного кэша. */
  shellMatch?: Response;
  /** `caches.open` падает (приватный режим, квота). */
  storageBroken?: boolean;
  /** Сетевой ответ навигации; по умолчанию — отказ, как в офлайне. */
  network?: () => Promise<Response>;
  /** Ответ `caches.match(event.request)` для не-навигационного запроса. */
  assetMatch?: Response;
}

/** Поднимает воркер и возвращает его обработчик `fetch`. */
function boot(options: StandOptions = {}) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const fakeSelf = {
    addEventListener: (type: string, cb: (event: unknown) => void) => { listeners[type] = cb; },
    location: { origin: ORIGIN },
    clients: { claim: () => undefined },
    skipWaiting: () => undefined,
  };

  const emptyCache: FakeCache = {
    match: async () => undefined,
    put: async () => undefined,
    add: async () => undefined,
  };
  const navCache: FakeCache = {
    ...emptyCache,
    match: async () => options.navMatch,
  };
  const assetCache: FakeCache = {
    ...emptyCache,
    match: async () => options.assetMatch,
  };

  const caches = {
    open: async (name: string) => {
      if (options.storageBroken) throw new Error('QuotaExceededError');
      return name.startsWith('jw-nav-') ? navCache : assetCache;
    },
    match: async (req: unknown) => (req === '/index.html' ? options.shellMatch : undefined),
    keys: async () => [],
    delete: async () => true,
  };

  const offlineNetwork = async () => { throw new TypeError('Failed to fetch'); };
  const fetchImpl = options.network ?? offlineNetwork;

  // sw.js — обычный скрипт воркера: запускаем его в функции с подменённым
  // миром, чтобы не тащить ServiceWorker-окружение.
  const run = new Function('self', 'caches', 'fetch', 'URL', SW_SRC) as (
    self: unknown, caches: unknown, fetch: unknown, URL: unknown
  ) => void;
  run(fakeSelf, caches, fetchImpl, URL);

  const onFetch = listeners.fetch;
  expect(onFetch, 'воркер не подписал обработчик fetch').toBeTruthy();

  return {
    async dispatch(target: string, init: { mode?: string; destination?: string; method?: string } = {}) {
      let captured: Promise<Response> | undefined;
      onFetch!({
        request: {
          url: `${ORIGIN}${target}`,
          mode: init.mode ?? 'navigate',
          destination: init.destination ?? 'document',
          method: init.method ?? 'GET',
          clone() { return this; },
        },
        respondWith: (response: Promise<Response>) => { captured = response; },
      });
      expect(captured, 'обработчик не позвал respondWith').toBeTruthy();
      return captured!;
    },
  };
}

describe('SB-6: офлайн-фолбэк воркера не может быть undefined', () => {
  it('офлайн и пустой кэш — навигация получает читаемую страницу, а не пустоту', async () => {
    const worker = boot();
    const response = await worker.dispatch('/diary');

    expect(response).toBeInstanceOf(Response);
    // 200, а не 503: синтетический 503 на навигации Chrome всё равно оформляет
    // как свою страницу ошибки и теряет адрес (проверено на стенде).
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('Нет сети');
  });

  it('офлайн и shell из установочного кэша — отдаём настоящую оболочку, не заглушку', async () => {
    const worker = boot({ shellMatch: new Response('настоящая оболочка', { status: 200 }) });
    const response = await worker.dispatch('/diary');

    expect(response).toBeInstanceOf(Response);
    expect(await response.text()).toBe('настоящая оболочка');
  });

  it('офлайн и навигация уже в кэше — выигрывает записанный ответ', async () => {
    const worker = boot({
      navMatch: new Response('страница из навигационного кэша', { status: 200 }),
      shellMatch: new Response('настоящая оболочка', { status: 200 }),
    });
    const response = await worker.dispatch('/diary');

    expect(await response.text()).toBe('страница из навигационного кэша');
  });

  it('кэш-хранилище отказало — страница «Нет сети» всё равно приходит', async () => {
    const worker = boot({ storageBroken: true });
    const response = await worker.dispatch('/diary');

    expect(response).toBeInstanceOf(Response);
    expect(await response.text()).toContain('Нет сети');
  });

  it('ресурс из /assets/ отсутствует и в кэше, и в сети — respondWith не получает undefined', async () => {
    const worker = boot();
    const response = await worker.dispatch('/assets/app-legacy.js', { mode: 'cors', destination: 'script' });

    expect(response).toBeInstanceOf(Response);
  });
});
