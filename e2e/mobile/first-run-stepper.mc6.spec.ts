// MC-6: первый вход по паролю на телефоне — три полноэкранных шага вместо стопа
// окон. Проверяется то, ради чего всё затевалось: экран один, окон (`role=dialog`)
// ноль, текст крупнее, чем в модалке, шаг доходит до редактора, а после
// перезагрузки приложение больше ничего не спрашивает.
import { expect, test, type Page } from '@playwright/test';
import { autoHandlers, createMobileAccount, dismissFirstLoginDialogs, shot, zenOff, type Account } from './harness';

/** Вход, который НЕ убирает первый запуск: иначе нечего измерять. */
async function signInLeavingFirstRun(page: Page, tag: string): Promise<Account> {
  const account = await createMobileAccount(tag);
  await autoHandlers(page, account.password);
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  // Enter, а не клик — см. login(): раскрытая рейка перекрывает «Войти».
  await page.locator('input[type="password"]').press('Enter');
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 90_000 });
  return account;
}

for (const { w, h } of [{ w: 390, h: 844 }, { w: 360, h: 640 }]) {
  test.describe(`MC-6: степпер первого входа на ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('один экран, ноль окон, шаги доходят до редактора и не повторяются', async ({ page }) => {
      await zenOff(page);
      await signInLeavingFirstRun(page, `mc6-stepper-${w}`);

      const stepper = page.locator('[data-testid="first-run-stepper"]');
      await expect(stepper, 'степпер первого входа не появился').toBeVisible({ timeout: 60_000 });
      await expect(page.locator('[role="dialog"]'), 'под степпером взошло окно').toHaveCount(0);

      // Процент шага считается по живым шагам, а не по трём всегда.
      const stepLabel = await page.getByTestId('first-run-step').innerText();
      expect(stepLabel, `счётчик шагов: ${stepLabel}`).toMatch(/Шаг 1 из [123]|Step 1 of [123]/);

      const bulletSize = await stepper.locator('li').first().evaluate(el =>
        parseFloat(getComputedStyle(el).fontSize));
      expect(bulletSize, 'подсказка шага мельче 16 px').toBeGreaterThanOrEqual(16);

      const required = stepper.getByRole('checkbox', { name: /Обязательно|required/i }).first();
      const box = await required.boundingBox();
      expect(box?.height ?? 0, 'галочка согласия меньше 24 px').toBeGreaterThanOrEqual(24);

      // «Продолжить» выключена, пока обязательная галочка не стоит.
      const next = stepper.getByRole('button', { name: /^Продолжить$/ });
      await expect(next).toBeDisabled();
      await shot(page, `mc6-step1-${w}`);
      // MF-18 (SA-1): фон степпера непрозрачен — экран письма не просвечивает.
      const bg = await stepper.evaluate(el => getComputedStyle(el).backgroundColor);
      expect(/rgba\([^)]*,\s*0(\.\d+)?\)/.test(bg) || bg === 'transparent', `фон степпера ${bg}`).toBe(false);

      // Проход по шагам делает тот же обработчик харнесса, что раньше ходил по
      // окнам: ветка степпера в dismissFirstLoginDialogs.
      await dismissFirstLoginDialogs(page, true, 60_000);
      await expect(stepper, 'степпер не ушёл после прохода').toBeHidden({ timeout: 30_000 });

      await expect(page.locator('textarea').first(), 'степпер не довёл до редактора')
        .toBeVisible({ timeout: 30_000 });
      await shot(page, `mc6-editor-${w}`);

      await page.reload();
      await expect(page.locator('textarea').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-testid="first-run-stepper"]'), 'после перезагрузки степпер вернулся')
        .toHaveCount(0, { timeout: 20_000 });
      await expect(page.locator('[role="dialog"]'), 'после перезагрузки снова спросили окном')
        .toHaveCount(0, { timeout: 20_000 });
    });
  });
}
