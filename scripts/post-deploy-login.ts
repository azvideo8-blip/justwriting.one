import { chromium, type Page } from '@playwright/test';

/**
 * TB-17: настоящий вход на боевом сайте после выкатки. E2E в CI гоняет только
 * dev-сервер без GoTrue, поэтому «вход работает» там не проверялся никогда —
 * а «выкатка зелёная, войти нельзя» у нас уже случалось. Служебный аккаунт
 * заведён приглашением и прошёл мастер; его адрес и пароль — секреты
 * SMOKE_LOGIN_EMAIL / SMOKE_LOGIN_PASSWORD. Пароль в вывод не попадает.
 *
 *   npx tsx scripts/post-deploy-login.ts https://justwriting.ru/
 */

const TIMEOUT = 30_000;

async function submitLogin(page: Page, baseUrl: string, email: string, password: string): Promise<void> {
  await page.goto(new URL('/login', baseUrl).toString(), { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
}

async function main(): Promise<void> {
  const baseUrl = process.argv[2] ?? 'https://justwriting.ru/';
  const email = process.env.SMOKE_LOGIN_EMAIL ?? '';
  const password = process.env.SMOKE_LOGIN_PASSWORD ?? '';
  if (!email || !password) {
    console.error('SMOKE_LOGIN_EMAIL / SMOKE_LOGIN_PASSWORD не заданы — проверка входа не выполнена.');
    process.exit(1);
  }

  const errors: string[] = [];
  const browser = await chromium.launch({ headless: true });
  try {
    // 1. Неверный пароль: человек видит ошибку и остаётся на странице входа.
    {
      const page = await (await browser.newContext()).newPage();
      await submitLogin(page, baseUrl, email, `${password}-wrong`);
      try {
        await page.locator('[role="alert"]').first().waitFor({ state: 'visible', timeout: TIMEOUT });
      } catch {
        errors.push('неверный пароль: ошибка на странице входа не появилась');
      }
      if (!new URL(page.url()).pathname.startsWith('/login')) {
        errors.push(`неверный пароль: страница ушла с /login на ${new URL(page.url()).pathname}`);
      }
    }

    // 2. Верный пароль: сессия этого аккаунта и экран письма.
    {
      const page = await (await browser.newContext()).newPage();
      await submitLogin(page, baseUrl, email, password);
      try {
        await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: TIMEOUT });
      } catch {
        const alert = await page.locator('[role="alert"]').first().textContent().catch(() => null);
        errors.push(`верный пароль: вход не состоялся${alert ? ` («${alert.trim()}»)` : ''}`);
      }
      const signedInAs = await page.evaluate(() => {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i) ?? '';
          if (!/auth-token/.test(k)) continue;
          try { return (JSON.parse(localStorage.getItem(k) ?? '{}') as { user?: { email?: string } }).user?.email ?? null; } catch { /* next */ }
        }
        return null;
      });
      if (signedInAs?.toLowerCase() !== email.toLowerCase()) {
        errors.push('верный пароль: в браузере нет сессии этого аккаунта');
      }
      try {
        await page.locator('textarea').first().waitFor({ state: 'visible', timeout: TIMEOUT });
      } catch {
        errors.push('верный пароль: экран письма не открылся');
      }
    }
  } finally {
    await browser.close();
  }

  if (errors.length > 0) {
    console.error('❌ Проверка входа не прошла:');
    for (const e of errors) console.error(`  • ${e}`);
    process.exit(1);
  }
  console.log('✅ Вход на проде: неверный пароль отклонён, верный открывает экран письма.');
}

void main();
