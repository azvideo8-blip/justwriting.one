import { chromium, type Page } from '@playwright/test';
import { isMainRun } from './gate-paths.mjs';

/**
 * TB-17: настоящий вход на боевом сайте после выкатки. E2E в CI гоняет только
 * dev-сервер без GoTrue, поэтому «вход работает» там не проверялся никогда —
 * а «выкатка зелёная, войти нельзя» у нас уже случалось. Служебный аккаунт
 * заведён приглашением и прошёл мастер; его адрес и пароль — секреты
 * SMOKE_LOGIN_EMAIL / SMOKE_LOGIN_PASSWORD. Пароль в вывод не попадает.
 *
 *   npx tsx scripts/post-deploy-login.ts https://justwriting.ru/
 *
 * R7Q-034: `/auth` на проде ограничен 5 запросами в минуту, а смоук делает их
 * два (неверный пароль + верный) и запускается сразу после выкатки, когда
 * прогрев и прошлые попытки ещё в окне. Раньше 429 читался как «вход не
 * работает»: зелёная выкатка краснела по причине, к продукту не относящуюся, а
 * неверный пароль под 429 вообще проходил — сообщение-то на странице появилось.
 * Теперь лимит отличается от отказа и имеет запас на повтор.
 */

const TIMEOUT = 30_000;
/** EX_TEMPFAIL: проверка не провалена, её надо повторить. */
export const RATE_LIMIT_EXIT = 75;
/** Окно лимита — минута; вторая ступень с запасом, если окно сдвинулось. */
export const BACKOFF_MS = [20_000, 65_000];
const RATE_LIMIT_TEXT = /Слишком много попыток|Too many attempts/i;

export type Outcome = 'ok' | 'failed' | 'rate_limited';

/** 429 важнее успеха: ответ «слишком много попыток» — это не про пароль. */
export function classifyAttempt(o: { succeeded: boolean; saw429: boolean; alertText: string | null }): Outcome {
  if (o.saw429 || (o.alertText !== null && RATE_LIMIT_TEXT.test(o.alertText))) return 'rate_limited';
  return o.succeeded ? 'ok' : 'failed';
}

export function backoffMs(attempt: number): number {
  const i = Math.min(attempt, BACKOFF_MS.length - 1);
  return BACKOFF_MS[i] ?? 0;
}

/** Повтор только по лимиту; отказ продукта повторяется ровно столько же и не больше. */
export async function withRateLimitRetry(
  run: () => Promise<{ outcome: Outcome; detail?: string | undefined }>,
  sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
  log: (line: string) => void = line => console.warn(line),
): Promise<{ outcome: Outcome; detail?: string | undefined }> {
  for (let attempt = 0; ; attempt++) {
    const r = await run();
    if (r.outcome !== 'rate_limited' || attempt >= BACKOFF_MS.length) return r;
    const wait = backoffMs(attempt);
    log(`смоук: /auth ответил 429 (лимит 5 запросов в минуту) — ждём ${Math.round(wait / 1000)} с и пробуем ещё раз`);
    await sleep(wait);
  }
}

async function submitLogin(page: Page, baseUrl: string, email: string, password: string): Promise<number[]> {
  const codes: number[] = [];
  page.on('response', res => { if (res.url().includes('/auth/')) codes.push(res.status()); });
  await page.goto(new URL('/login', baseUrl).toString(), { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  return codes;
}

async function readAlert(page: Page): Promise<string | null> {
  return (await page.locator('[role="alert"]').first().textContent().catch(() => null))?.trim() ?? null;
}

async function main(): Promise<void> {
  const baseUrl = process.argv[2] ?? 'https://justwriting.ru/';
  const email = process.env.SMOKE_LOGIN_EMAIL ?? '';
  const password = process.env.SMOKE_LOGIN_PASSWORD ?? '';
  if (!email || !password) {
    console.error('SMOKE_LOGIN_EMAIL / SMOKE_LOGIN_PASSWORD не заданы — проверка входа не выполнена.');
    process.exit(1);
  }

  const problems: string[] = [];
  let rateLimited = false;
  const browser = await chromium.launch({ headless: true });
  try {
    // 1. Неверный пароль: человек видит ошибку и остаётся на странице входа.
    {
      const r = await withRateLimitRetry(async () => {
        const page = await (await browser.newContext()).newPage();
        const codes = await submitLogin(page, baseUrl, email, `${password}-wrong`);
        const alertSeen = await page.locator('[role="alert"]').first()
          .waitFor({ state: 'visible', timeout: TIMEOUT }).then(() => true, () => false);
        const alertText = await readAlert(page);
        const stayed = new URL(page.url()).pathname.startsWith('/login');
        const outcome = classifyAttempt({ succeeded: alertSeen && stayed, saw429: codes.includes(429), alertText });
        const detail = !stayed ? `страница ушла с /login на ${new URL(page.url()).pathname}` : undefined;
        await page.context().close();
        return { outcome, detail };
      });
      if (r.outcome === 'rate_limited') { rateLimited = true; console.warn('неверный пароль: проверка не засчитана — лимит /auth'); }
      else if (r.outcome === 'failed') problems.push(`неверный пароль: ${r.detail ?? 'ошибка на странице входа не появилась'}`);
    }

    // 2. Верный пароль: сессия этого аккаунта и экран письма.
    {
      const r = await withRateLimitRetry(async () => {
        const page = await (await browser.newContext()).newPage();
        const codes = await submitLogin(page, baseUrl, email, password);
        const entered = await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: TIMEOUT })
          .then(() => true, () => false);
        const alertText = entered ? null : await readAlert(page);
        const signedInAs = entered ? await page.evaluate(() => {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i) ?? '';
            if (!/auth-token/.test(k)) continue;
            try { return (JSON.parse(localStorage.getItem(k) ?? '{}') as { user?: { email?: string } }).user?.email ?? null; } catch { /* next */ }
          }
          return null;
        }) : null;
        const editor = entered && signedInAs?.toLowerCase() === email.toLowerCase()
          ? await page.locator('textarea').first().waitFor({ state: 'visible', timeout: TIMEOUT }).then(() => true, () => false)
          : false;
        const outcome = classifyAttempt({ succeeded: editor, saw429: codes.includes(429), alertText });
        const detail = entered
          ? (signedInAs?.toLowerCase() !== email.toLowerCase() ? 'в браузере нет сессии этого аккаунта' : 'экран письма не открылся')
          : `вход не состоялся${alertText ? ` («${alertText}»)` : ''}`;
        await page.context().close();
        return { outcome, detail };
      });
      if (r.outcome === 'rate_limited') { rateLimited = true; console.warn('верный пароль: проверка не засчитана — лимит /auth'); }
      else if (r.outcome === 'failed') problems.push(`верный пароль: ${r.detail}`);
    }
  } finally {
    await browser.close();
  }

  if (problems.length > 0) {
    console.error('❌ Проверка входа не прошла:');
    for (const e of problems) console.error(`  • ${e}`);
    process.exit(1);
  }
  if (rateLimited) {
    // Не «вход сломан»: смоук упёрся в лимит и про product-вердикт молчит.
    console.error(`❓ Проверка входа не завершена: /auth отдал 429 и после повторов. Это лимит (5 запросов в минуту), а не отказ входа; выход ${RATE_LIMIT_EXIT}.`);
    process.exit(RATE_LIMIT_EXIT);
  }
  console.log('✅ Вход на проде: неверный пароль отклонён, верный открывает экран письма.');
}

// Без guard'а импорт модуля из теста запускал бы Chromium.
if (isMainRun(process.argv[1], import.meta.url)) void main();
