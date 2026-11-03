import { test, expect } from '@playwright/test';
import { createUser } from './stand';

/**
 * CK-2: часы устройства спешат — предупреждение видно сразу после входа.
 *
 * Живой случай 02.11: Windows с часами +2 ч, токен на 1 час просрочен с рождения,
 * обновления идут подряд, и человек получает «Сессия завершилась неожиданно»,
 * не понимая, что дело в часах. Проверка на стенде: `Date.now` сдвинут ровно как
 * в спеке 12 двух устройств (`e2e/dialogueSync.stand.spec.ts:518`), аккаунт —
 * синтетический, созданный этим же прогоном.
 */
const SKEW_MS = 2 * 3600_000;

test('CK-2: часы +2 ч — после входа есть тост про расхождение часов', async ({ browser }) => {
  const account = await createUser('ck2');
  const ctx = await browser.newContext();
  await ctx.addInitScript((off) => {
    const real = Date.now;
    Date.now = () => real() + off;
  }, SKEW_MS);
  const page = await ctx.newPage();

  await page.goto('/login');
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.locator('button[type="submit"]').click();

  // Ждём сам тост, а не только уход со страницы входа: он появляется, когда
  // вкладка узнала uid и сверila `iat` токена со своими часами.
  await expect(page.getByText('Часы устройства расходятся')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/примерно на 2 ч/)).toBeVisible();

  await ctx.close();
});
