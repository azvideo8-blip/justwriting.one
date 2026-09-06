import { chromium, type Browser, type Page } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage, ClientRequest } from 'node:http';
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
  timeoutMs?: number;
}

interface SmokeCheckResult {
  success: boolean;
  actualVersion?: string | undefined;
  errors: string[];
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
      if (apiResp.status !== 401) {
        errors.push(`/api/chatWithAI без токена вернул HTTP ${apiResp.status} вместо 401`);
      }
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

function openChatStreamThenDestroy(
  origin: string,
  token: string,
  reasoning = false,
): Promise<void> {
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
        // Заголовки пришли. Уничтожаем сокет до первого байта контента —
        // ровно тот случай, на который рассчитан res.on('close') в api/chat.ts.
        res.destroy();
        resolve();
      },
    );
    req.on('timeout', () => { req.destroy(new Error('chat stream timeout')); });
    req.on('error', (e) => {
      // destroy() выше вызывает ECONNRESET / socket hang up на клиенте — норма.
      const msg = String((e as NodeJS.ErrnoException).code ?? e);
      if (/ECONNRESET|ERR_STREAM_PREMATURE_CLOSE|socket hang up/.test(msg)) resolve();
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

      await openChatStreamThenDestroy(origin, token, c.reasoning);

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

async function main() {
  const targetUrl = process.argv[2] || process.env.SMOKE_URL || 'https://justwriting.ru/';
  const expectedVersion = process.env.EXPECTED_VERSION || APP_VERSION;

  console.log(`\n🔍 Запуск проверки после выкатки: ${targetUrl}`);
  console.log(`📌 Ожидаемая версия приложения: v${expectedVersion}\n`);

  const result = await runSmokeCheck({
    baseUrl: targetUrl,
    expectedVersion,
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Фатальная ошибка проверки:', err);
    process.exit(1);
  });
}
