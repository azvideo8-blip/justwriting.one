import { chromium, type Browser, type Page } from '@playwright/test';
import { createHash, createHmac } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage, ClientRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../src/version';

/**
 * node:http.request отказывается от адреса на https с
 * `ERR_INVALID_PROTOCOL`. Проверка ходит на боевой https-домен, поэтому обе
 * её функции падали на первом же запросе — и падали молча, пока итог не
 * учитывал их ошибки. Выбираем реализацию по протоколу адреса.
 */
export function requestFor(url: string): typeof httpRequest {
  return url.startsWith('https:') ? (httpsRequest as typeof httpRequest) : httpRequest;
}

interface SmokeCheckOptions {
  baseUrl: string;
  expectedVersion?: string;
  expectedIndexSha256?: string | undefined;
  timeoutMs?: number;
}

interface SmokeCheckResult {
  success: boolean;
  actualVersion?: string | undefined;
  errors: string[];
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * F-002 / F-055: версия на странице не доказывает, что на сервер лёг именно
 * собранный файл. Перевыкатка той же версии после неудачного копирования
 * выглядит целой — сверяем байты index.html.
 *
 * Ничего не вырезаем и не нормализуем: sub_filter и SSI в deploy/nginx.conf
 * отсутствуют, значит отданное тело обязано быть собранным телом один в один.
 */
export function indexHashErrors(servedHex: string, expectedHex: string): string[] {
  if (servedHex === expectedHex) return [];
  return [
    `index.html на сервере != собранный: sha256 собранного ${expectedHex}, отданного ${servedHex}. ` +
    'Версия при этом может совпадать — при перевыкатке того же номера неудачное копирование не видно.',
  ];
}

/** Хэш из вывода `sha256sum`: он с суффиксом `sha256:` и именем файла. */
export function normalizeSha256(raw: string): string {
  return raw.trim().replace(/^sha256:/, '').split(/\s+/)[0]!.toLowerCase();
}

export async function checkIndexHtmlHash(options: {
  baseUrl: string;
  expectedIndexSha256: string | undefined;
  timeoutMs?: number;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Pick<Response, 'status' | 'arrayBuffer'>>;
}): Promise<string[]> {
  const { baseUrl, expectedIndexSha256, timeoutMs = 20_000 } = options;
  if (!expectedIndexSha256) {
    console.log('⏭️  Сверка index.html по sha256 ПРОПУЩЕНА: нет EXPECTED_INDEX_SHA256 — в этом прогоне клиент не выкатывался.');
    return [];
  }

  const expected = normalizeSha256(expectedIndexSha256);
  const url = new URL('/index.html', baseUrl).toString();
  const doFetch = options.fetchImpl ?? fetch;
  let response: Pick<Response, 'status' | 'arrayBuffer'>;
  try {
    response = await doFetch(url, {
      headers: { 'accept-encoding': 'identity', 'cache-control': 'no-cache', Pragma: 'no-cache' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return [`Не удалось получить ${url} для сверки sha256: ${String(err)}`];
  }

  if (response.status !== 200) {
    return [`index.html вернул HTTP ${response.status} вместо 200`];
  }

  const served = sha256Hex(new Uint8Array(await response.arrayBuffer()));
  return indexHashErrors(served, expected);
}

// ── M-9 (L-7): чужой Host на :80 и один content-type у sw.js ────────────────

/** Сколько раз заголовок пришёл в ответе. rawHeaders — [имя, значение, …]
 *  как на проводе; fetch и res.headers склеивают дубли, поэтому считаем здесь. */
export function countRawHeader(rawHeaders: string[], name: string): number {
  let n = 0;
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i]!.toLowerCase() === name) n++;
  }
  return n;
}

/** Редирект с чужим Host обязан вести на канонический адрес, а не на Host
 *  (R4-059: иначе :80 — открытый редиректор). */
export function foreignHostRedirectErrors(status: number, location: string | undefined, origin: string): string[] {
  if (![301, 302, 307, 308].includes(status)) {
    return [`http:// с чужим Host вернул HTTP ${status} вместо редиректа на ${origin}/`];
  }
  if (!location?.startsWith(`${origin}/`)) {
    return [`http:// с чужим Host редиректит на «${location ?? ''}», а не на ${origin}/ — открытый редиректор`];
  }
  return [];
}

/** Проверка #3: POST /api/chatWithAI без токена обязан дать 401.
 *  R5-011: 429 — лимит nginx `api_limit`, общий для /api/ и /ready, а раннер
 *  бьёт с одного адреса вместе с монитором и проверкой входа. Это «не
 *  измерено» (громко, как M-2 для стрима), а не провал: провал откатывает
 *  здоровую службу. 502/503/200 и прочее — провал, как и было. */
export function apiNoTokenErrors(status: number): string[] {
  if (status === 401) return [];
  if (status === 429) {
    console.warn('::warning::/api/chatWithAI без токена: не измерено: 429 (лимит api_limit) — 401 не проверен.');
    return [];
  }
  return [`/api/chatWithAI без токена вернул HTTP ${status} вместо 401`];
}

/** R5-012: извне :80 с чужим Host соединение рвут до nginx (curl: «Empty reply
 *  from server»). Сегодня раннер стоит на самом сервере и ответ приходит, но
 *  обрыв/тайм-аут — это «ответа нет», а не открытый редиректор: громкое «не
 *  измерено». Любой полученный ответ по-прежнему обязан вести на origin. */
export function isNoResponse(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === 'ECONNRESET' || e?.message === 'timeout';
}

export function swContentTypeErrors(status: number, rawHeaders: string[]): string[] {
  if (status !== 200) return [`sw.js вернул HTTP ${status} вместо 200`];
  const n = countRawHeader(rawHeaders, 'content-type');
  return n === 1 ? [] : [`sw.js отдаёт content-type ${n} раз(а) вместо одного`];
}

/** GET без следования редиректам; тело не читаем. */
function rawGet(url: string, headers: Record<string, string>, timeoutMs: number):
  Promise<{ status: number; rawHeaders: string[]; location: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = requestFor(url)(url, { method: 'GET', headers, timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, rawHeaders: res.rawHeaders, location: res.headers.location });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

export async function checkHostAndSwHeaders(baseUrl: string, timeoutMs = 20_000): Promise<string[]> {
  const origin = new URL(baseUrl).origin;
  const errors: string[] = [];

  const plain = new URL('/p', baseUrl);
  plain.protocol = 'http:';
  try {
    const r = await rawGet(plain.toString(), { Host: 'evil.example.com' }, timeoutMs);
    errors.push(...foreignHostRedirectErrors(r.status, r.location, origin));
  } catch (err) {
    if (isNoResponse(err)) {
      console.warn(`::warning::${plain} с чужим Host: не измерено — ответа нет (${String(err)}).`);
    } else {
      errors.push(`Не удалось запросить ${plain} с чужим Host: ${String(err)}`);
    }
  }

  const sw = new URL('/sw.js', baseUrl).toString();
  try {
    const r = await rawGet(sw, { 'cache-control': 'no-cache' }, timeoutMs);
    errors.push(...swContentTypeErrors(r.status, r.rawHeaders));
  } catch (err) {
    errors.push(`Не удалось запросить ${sw}: ${String(err)}`);
  }
  return errors;
}

// S-16 (R6Q-011): живая проверка запрета скрытых файлов и резервных копий
export async function checkHiddenAndBackupFiles(baseUrl: string, timeoutMs = 20_000): Promise<string[]> {
  const errors: string[] = [];

  const prevUrl = new URL('/index.html.prev', baseUrl).toString();
  try {
    const r = await rawGet(prevUrl, {}, timeoutMs);
    if (r.status !== 404) {
      errors.push(`GET /index.html.prev вернул HTTP ${r.status} вместо 404`);
    }
  } catch (err) {
    errors.push(`Не удалось запросить ${prevUrl}: ${String(err)}`);
  }

  const envUrl = new URL('/.env', baseUrl).toString();
  try {
    const r = await rawGet(envUrl, {}, timeoutMs);
    if (r.status === 200) {
      errors.push(`GET /.env вернул HTTP 200 (утечка конфигурации)`);
    }
  } catch (err) {
    errors.push(`Не удалось запросить ${envUrl}: ${String(err)}`);
  }

  return errors;
}

export async function runSmokeCheck(options: SmokeCheckOptions): Promise<SmokeCheckResult> {
  const { baseUrl, expectedVersion = APP_VERSION, timeoutMs = 20_000 } = options;
  const errors: string[] = [];
  const origin = new URL(baseUrl).origin;

  let browser: Browser | null = null;
  let actualVersion: string | undefined;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      extraHTTPHeaders: {
        'Cache-Control': 'no-cache, no-store',
        Pragma: 'no-cache',
      },
    });

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];

    const page: Page = await context.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('pageerror', (err) => {
      pageErrors.push(err.stack || err.message);
    });

    page.on('requestfailed', (req) => {
      const url = req.url();
      if (url.startsWith(origin)) {
        failedRequests.push(`${req.method()} ${url} -> ${req.failure()?.errorText || 'failed'}`);
      }
    });

    // 1. Проверка главной страницы
    const response = await page.goto(baseUrl, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });

    if (!response) {
      errors.push(`Не удалось получить HTTP-ответ от ${baseUrl}`);
    } else if (response.status() !== 200) {
      errors.push(`Главная страница вернула HTTP ${response.status()} вместо 200`);
    } else {
      const permPolicy = response.headers()['permissions-policy'] || '';
      if (permPolicy.includes('microphone=()')) {
        errors.push(`Permissions-Policy header blocks microphone completely: "${permPolicy}" (expected microphone=(self))`);
      }
    }

    try {
      await page.waitForSelector('#root > *', { timeout: 15_000 });
    } catch {
      errors.push('Таймаут ожидания монтирования приложения (#root > *)');
    }

    // Проверка Error Boundary
    const errorBoundary = await page.$('[data-testid="error-boundary"]');
    if (errorBoundary) {
      const errorText = (await errorBoundary.textContent()) || '';
      errors.push(`Обнаружен экран Error Boundary: ${errorText.trim().slice(0, 300)}`);
    } else {
      const bodyText = (await page.textContent('body')) || '';
      if (bodyText.includes('Что-то пошло не так') && bodyText.includes('ERR-')) {
        errors.push('Обнаружен текст экрана ошибки приложения («Что-то пошло не так»)');
      }
    }

    // Проверка версии приложения
    actualVersion = await page.evaluate(() => {
      return (
        (window as unknown as { __APP_VERSION__?: string }).__APP_VERSION__ ||
        document.documentElement.dataset.appVersion
      );
    });

    if (!actualVersion) {
      errors.push('Версия приложения не найдена в DOM / window.__APP_VERSION__ (JS не выполнил инициализацию)');
    } else if (expectedVersion && actualVersion !== expectedVersion) {
      errors.push(`Несовпадение версии: ожидалась ${expectedVersion}, на странице ${actualVersion}`);
    }

    // Проверка консольных и скриптовых ошибок
    if (pageErrors.length > 0) {
      errors.push(`Ошибки выполнения скриптов (pageerror):\n  ${pageErrors.join('\n  ')}`);
    }
    if (consoleErrors.length > 0) {
      errors.push(`Ошибки в консоли браузера (console.error):\n  ${consoleErrors.join('\n  ')}`);
    }
    if (failedRequests.length > 0) {
      errors.push(`Сбойные сетевые запросы к собственному origin:\n  ${failedRequests.join('\n  ')}`);
    }

    // 2. Проверка предрендеренной страницы /privacy
    const privacyUrl = new URL('/privacy', origin).toString();
    const privacyPage = await context.newPage();
    try {
      const privacyResp = await privacyPage.goto(privacyUrl, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });
      if (!privacyResp || privacyResp.status() !== 200) {
        errors.push(`/privacy вернула HTTP ${privacyResp?.status() ?? 'null'} вместо 200`);
      }
      // Смотреть надо на отданный HTML, а не на отрисованный DOM. Приложение
      // рисует политику на клиенте в любом случае, поэтому страница-заглушка
      // после гидратации выглядит целой — и проверка по #root прошла бы мимо
      // ровно той поломки, ради которой она здесь. 21 августа предрендер в CI
      // молча свалился на meta-only, и /privacy отдавалась оболочкой на 4,8 КБ
      // без единого слова политики, хотя в браузере открывалась нормально.
      const servedHtml = privacyResp ? await privacyResp.text() : '';
      // Искать по всему документу нельзя: заголовок страницы содержит название
      // политики и в заглушке тоже — meta-only страница по определению
      // сохраняет <title> и мета-теги. Смотреть надо ровно на содержимое
      // #root, потому что предрендер именно его и наполняет.
      const rootStart = servedHtml.indexOf('<div id="root">');
      const rootHtml = rootStart === -1 ? '' : servedHtml.slice(rootStart);
      const hasPolicyText = rootHtml.includes('Оператор') || rootHtml.includes('персональных данных');
      if (!hasPolicyText) {
        errors.push(
          `/privacy отдаётся без текста политики: предрендер деградировал до оболочки ` +
          `(${servedHtml.length} байт HTML). Проверьте, что Chromium установлен в раннере.`
        );
      }
    } catch (err) {
      errors.push(`Сбой проверки предрендеренной страницы /privacy: ${String(err)}`);
    } finally {
      await privacyPage.close().catch(() => {});
    }

    // 3. Проверка API эндпоинта /api/chatWithAI без токена (ожидается 401)
    const apiUrl = new URL('/api/chatWithAI', origin).toString();
    try {
      const apiResp = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: {} }),
        signal: AbortSignal.timeout(10_000),
      });
      errors.push(...apiNoTokenErrors(apiResp.status));
    } catch (err) {
      errors.push(`Не удалось выполнить запрос к API ${apiUrl}: ${String(err)}`);
    }
  } catch (err) {
    errors.push(`Критический сбой запуска проверки Playwright: ${String(err)}`);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  // 4. Байты index.html против собранных. Отдельно от браузера: тут важен
  // не отрисованный DOM, а ровно то, что отдал сервер.
  errors.push(...await checkIndexHtmlHash({
    baseUrl,
    expectedIndexSha256: options.expectedIndexSha256,
    timeoutMs,
  }));

  // 5. M-9: заголовки на проводе, мимо браузера — он склеивает дубли и сам
  // идёт по редиректам.
  errors.push(...await checkHostAndSwHeaders(baseUrl, timeoutMs));

  // 6. S-16: живая проверка запрета скрытых файлов и резервных копий
  errors.push(...await checkHiddenAndBackupFiles(baseUrl, timeoutMs));

  return {
    success: errors.length === 0,
    actualVersion,
    errors,
  };
}

// ── §3.8: возврат слота при обрыве стрима ─────────────────────────────────────
//
// Юнит-тест (api/__tests__/chatStreamClose.test.ts) доказывает логику, но не
// живой сокет. Этот кейс открывает настоящий /api/chat, рвёт соединение после
// заголовков, но до первого байта контента, и проверяет по счётчику
// ai_daily_limit (через admin-эндпойнт getAIUsageStats), что слот вернулся.
//
// Требует SMOKE_JWT_SECRET (= SUPABASE_JWT_SECRET сервера) и SMOKE_UID
// (uid админа). Без них кейс пропускается: без секрета токен не отчеканить.
// Гарантия refund'а действует только на VPS — res.on('close') ненадёжен на
// serverless-edge, поэтому результат не обобщается на другие площадки.

// Токен должен пройти ту же проверку, что и настоящий: с 0.8.13 служба требует
// аудиторию `authenticated` и издателя, совпадающего с GOTRUE_JWT_ISSUER. Без
// них проверка молча получала 401 и никогда не могла пройти — а выглядела как
// пропущенная по отсутствию секрета.
function mintSmokeJwt(secret: string, uid: string, issuer: string): string {
  const b64u = (buf: Buffer | string) =>
    Buffer.from(buf).toString('base64url');
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64u(
    JSON.stringify({
      sub: uid,
      aud: 'authenticated',
      role: 'authenticated',
      iss: issuer,
      iat: now,
      exp: now + 300,
    }),
  );
  const sig = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function apiPost(
  origin: string,
  path: string,
  token: string,
  body: unknown,
  timeoutMs = 15_000,
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = requestFor(origin)(
      `${origin}${path}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: timeoutMs,
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          let parsed: unknown = null;
          try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
          resolve({ status: res.statusCode ?? 0, json: parsed });
        });
      },
    );
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.end(data);
  });
}

/**
 * Достаёт `used` из ответа /api/getAIUsageStats.
 *
 * Диспетчер заворачивает ответ обработчика в конверт `{ result: … }`
 * (api/handlers.ts). Чтение `json.events` напрямую давало undefined ВСЕГДА, и
 * проверка возврата падала на каждом запуске — молча, потому что её ошибки не
 * влияли на итог (см. main). Поддерживаем обе формы: с конвертом и без.
 */
export function usedFromStatsBody(json: unknown): number {
  const body = json as { result?: unknown } | null;
  const inner = (body && typeof body === 'object' && 'result' in body ? body.result : body) as
    { events?: Array<{ used?: number }> } | null;
  const used = inner?.events?.[0]?.used;
  if (typeof used !== 'number') {
    throw new Error(`getAIUsageStats ответил без used: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return used;
}

async function fetchDailyUsed(
  origin: string,
  token: string,
  uid: string,
): Promise<number> {
  const date = new Date().toISOString().slice(0, 10);
  const res = await apiPost(origin, '/api/getAIUsageStats', token, {
    date,
    targetUid: uid,
  });
  if (res.status !== 200) {
    throw new Error(`getAIUsageStats вернул HTTP ${res.status}: ${JSON.stringify(res.json).slice(0, 200)}`);
  }
  return usedFromStatsBody(res.json);
}

/** Код ошибки из тела sendError (`{ error: { code } }`); пусто — не JSON. */
export function errorCodeFromBody(raw: string): string {
  try {
    const code = (JSON.parse(raw) as { error?: { code?: unknown } } | null)?.error?.code;
    return typeof code === 'string' ? code : '';
  } catch {
    return '';
  }
}

function openChatStreamThenDestroy(
  origin: string,
  token: string,
  reasoning = false,
): Promise<{ status: number; code: string }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      personaId: 'coach',
      ...(reasoning ? { reasoning: true } : {}),
      messages: [
        { role: 'user', content: 'smoke: ответь одним коротким предложением про тишину.' },
      ],
    });
    const req: ClientRequest = requestFor(origin)(
      `${origin}/api/chat`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 60_000,
      },
      (res: IncomingMessage) => {
        // L-10 (R4-072): 401/429/5xx — стрима не было, «возврат слота»
        // измерялся на пустом месте и рапортовал успех.
        // M-2: но и провалом это не делаем — 403 согласия, 429 лимитов (включая
        // глобальный потолок) и 502/504 откатили бы здоровую службу. Отдаём
        // статус и код наверх: там громкое «не измерено».
        if (res.statusCode !== 200) {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve({
            status: res.statusCode ?? 0,
            code: errorCodeFromBody(Buffer.concat(chunks).toString()),
          }));
          return;
        }
        // Заголовки пришли. Уничтожаем сокет до первого байта контента —
        // ровно тот случай, на который рассчитан res.on('close') в api/chat.ts.
        res.destroy();
        resolve({ status: 200, code: '' });
      },
    );
    req.on('timeout', () => { req.destroy(new Error('chat stream timeout')); });
    req.on('error', (e) => {
      // destroy() выше вызывает ECONNRESET / socket hang up на клиенте — норма:
      // промис к этому моменту уже разрешён со статусом 200. Сюда без него —
      // сброс до заголовков, стрима не было: тоже «не измерено».
      const msg = String((e as NodeJS.ErrnoException).code ?? e);
      if (/ECONNRESET|ERR_STREAM_PREMATURE_CLOSE|socket hang up/.test(msg)) resolve({ status: 0, code: msg });
      else reject(e);
    });
    req.end(body);
  });
}

export async function checkChatStreamRefund(baseUrl: string): Promise<string[]> {
  const errors: string[] = [];
  const secret = process.env.SMOKE_JWT_SECRET;
  const uid = process.env.SMOKE_UID;
  if (!secret || !uid) {
    errors.push('SMOKE_JWT_SECRET или SMOKE_UID не заданы — проверка обрыва стрима не может быть выполнена.');
    return errors;
  }

  const origin = new URL(baseUrl).origin;
  // Издатель по умолчанию выводится из адреса, а не зашивается: у GoTrue он
  // равен `${origin}/auth/v1`. Переопределяется, если развёрнуто иначе.
  const issuer = process.env.SMOKE_JWT_ISS ?? `${origin}/auth/v1`;
  const token = mintSmokeJwt(secret, uid, issuer);

  // Обрыв на заголовках — это «человек нажал Стоп сразу». Дневной слот обязан
  // вернуться в обеих ветках: он возвращается, пока поставщик выдал меньше
  // порога, а не по факту первого токена. Глобальный резерв за выданные токены
  // не возвращается — это отдельное правило, AG-BILL-1.
  //
  // Пауза между случаями больше кулдауна, иначе второй запрос отбивается до
  // тарификации и проверка становится пустой.
  const cases = [
    { reasoning: true, name: 'чат с рассуждениями', expectRefund: true },
    { reasoning: false, name: 'обычный чат', expectRefund: true },
  ];

  for (const c of cases) {
    try {
      const before = await fetchDailyUsed(origin, token, uid);

      const stream = await openChatStreamThenDestroy(origin, token, c.reasoning);
      if (stream.status !== 200) {
        const isExternalUnmeasured =
          (stream.status === 403 && stream.code === 'AI_CONSENT_REQUIRED') ||
          stream.status === 429 ||
          (stream.status === 502 && stream.code === 'UPSTREAM_ERROR') ||
          (stream.status === 504 && stream.code === 'UPSTREAM_TIMEOUT');

        if (isExternalUnmeasured) {
          // M-2: громко, но не провал выкатки — слот не измерен из-за внешних лимитов/провайдера.
          console.warn(
            `::warning::Обрыв стрима (${c.name}): не измерено: ${stream.status} ${stream.code || '-'} — ` +
            'стрим не открылся, проверка возврата слота пропущена.',
          );
          continue;
        }

        // S-6: Внутренние ошибки (500, 404, 400, 401, 503, 502 без кода, сброс сокета) — провал деплоя.
        errors.push(
          `Обрыв стрима (${c.name}): ошибка ${stream.status} ${stream.code || '-'} — ` +
          'эндпоинт /api/chat вернул ошибку, деплой не может быть подтверждён.',
        );
        continue;
      }

      // Даём серверу время получить RST и исполнить res.on('close').
      // Пауза больше кулдауна (COOLDOWN_MS = 10 с): иначе второй запрос
      // отбивается лимитом ДО тарификации, счётчик не меняется, и проверка
      // выглядит пройденной, ничего не проверив. Так она и «проходила».
      await new Promise((r) => setTimeout(r, 12_000));

      const after = await fetchDailyUsed(origin, token, uid);
      const delta = after - before;

      if (c.expectRefund) {
        if (delta !== 0) {
          errors.push(
            `Обрыв стрима (${c.name}) списал слот: счётчик ai_daily_limit ${before} → ${after} ` +
            '(возврат при обрыве до первой выдачи не сработал).',
          );
        } else {
          console.log(`✅ Обрыв стрима (${c.name}): слот возвращён, счётчик не изменился (${before}).`);
        }
      } else if (delta < 0 || delta > 1) {
        // Здесь допустимы и 0, и 1: успел ли поставщик выдать первый кусок до
        // заголовков — вопрос миллисекунд, и оба исхода правильны по DEEP-8.
        // Ворота выкатки не должны зависеть от такой гонки: откат исправного
        // релиза стоит дороже, чем эта проверка приносит. Настоящая гарантия
        // возврата для этой ветки — детерминированный юнит-тест в
        // api/__tests__/chatStreamClose.test.ts. Здесь остаётся более грубое,
        // но устойчивое утверждение: обрыв не может списать больше одного слота.
        errors.push(
          `Обрыв стрима (${c.name}): счётчик ai_daily_limit ${before} → ${after}, ожидалось 0 или +1 ` +
          '(обрыв не должен списывать больше одного слота).',
        );
      } else {
        console.log(`✅ Обрыв стрима (${c.name}): списано не больше одного слота (${before} → ${after}).`);
      }
    } catch (err) {
      errors.push(`Кейс обрыва стрима (${c.name}) не выполнился: ${String(err)}`);
    }
  }

  return errors;
}

/** Какую версию клиента ждать на странице. Пусто — сверка версии пропускается:
 *  при выкатке одной службы (what = api) на сервере законно лежит прежний клиент. */
export function resolveExpectedVersion(env: Record<string, string | undefined>): string {
  if (env.SMOKE_CLIENT_DEPLOYED === 'false') return '';
  return env.EXPECTED_VERSION || APP_VERSION;
}

async function main() {
  const targetUrl = process.argv[2] || process.env.SMOKE_URL || 'https://justwriting.ru/';
  const expectedVersion = resolveExpectedVersion(process.env);
  const expectedIndexSha256 = process.env.EXPECTED_INDEX_SHA256;

  console.log(`\n🔍 Запуск проверки после выкатки: ${targetUrl}`);
  console.log(expectedVersion
    ? `📌 Ожидаемая версия приложения: v${expectedVersion}`
    : '⏭️  Сверка версии клиента ПРОПУЩЕНА: в этом прогоне клиент не выкатывался.');
  console.log(`📌 Ожидаемый sha256 index.html: ${expectedIndexSha256 ? normalizeSha256(expectedIndexSha256) : 'не передан'}`);
  console.log('');

  const result = await runSmokeCheck({
    baseUrl: targetUrl,
    expectedVersion,
    expectedIndexSha256,
  });

  const refundErrors = await checkChatStreamRefund(targetUrl);
  result.errors.push(...refundErrors);

  // Итог считается по ВСЕМ ошибкам. Раньше `result.success` вычислялся до
  // проверки возврата, и её ошибки, уже лежащие в списке, не влияли ни на код
  // выхода, ни на вывод: проверка падала на каждой выкатке и печатала «принято».
  const success = result.success && refundErrors.length === 0;

  if (!success) {
    console.error('❌ [SMOKE CHECK FAILED] Проверка после выкатки не прошла:');
    for (const err of result.errors) {
      console.error(`  • ${err}`);
    }
    console.error('');
    process.exit(1);
  }

  console.log(
    `✅ [SMOKE CHECK PASSED] Приложение открывается штатно (v${result.actualVersion}), /privacy содержит текст, ИИ без токена 401 — выкатка принята.\n`
  );
}

// L-10 (R4-073): сравнение через `file://${argv[1]}` ложно при пробеле или
// симлинке в пути — main() молча не запускался и скрипт выходил 0.
// M-6: argv[1] — путь как вызвали, симлинк не раскрыт; сравниваем реальные пути.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error('Фатальная ошибка проверки:', err);
    process.exit(1);
  });
}
