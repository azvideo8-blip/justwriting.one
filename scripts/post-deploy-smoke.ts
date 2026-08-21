import { chromium, type Browser, type Page } from '@playwright/test';
import { APP_VERSION } from '../src/version';

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

async function main() {
  const targetUrl = process.argv[2] || process.env.SMOKE_URL || 'https://justwriting.ru/';
  const expectedVersion = process.env.EXPECTED_VERSION || APP_VERSION;

  console.log(`\n🔍 Запуск проверки после выкатки: ${targetUrl}`);
  console.log(`📌 Ожидаемая версия приложения: v${expectedVersion}\n`);

  const result = await runSmokeCheck({
    baseUrl: targetUrl,
    expectedVersion,
  });

  if (!result.success) {
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
