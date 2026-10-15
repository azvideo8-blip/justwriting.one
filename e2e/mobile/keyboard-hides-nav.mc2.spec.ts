// MC-2: на письме и в чате поднятая клавиатура убирает нижнюю панель, а панель
// инструментов встаёт на 8 px над клавиатурой, а не над панелью вкладок.
// Клавиатура эмулируется сжатием вьюпорта (как в MR-2).
import { expect, test, type Page } from '@playwright/test';
import { fullyInViewport, grantAiConsent, shot, signInMobile, unlockVaultIfAsked, zenOff } from './harness';

const nav = (page: Page) => page.getByTestId('mobile-bottom-nav');
const navHidden = (page: Page) => () => nav(page).getAttribute('aria-hidden').then(v => v === 'true');
const navShown = (page: Page) => () => nav(page).getAttribute('aria-hidden').then(v => v === null);

async function linesInEditor(page: Page): Promise<number> {
  return page.locator('textarea').first().evaluate((el) => {
    const lh = parseFloat(window.getComputedStyle(el).lineHeight) || 30;
    return (el as HTMLTextAreaElement).clientHeight / lh;
  });
}

for (const { w, h, shrink } of [{ w: 360, h: 640, shrink: 280 }, { w: 390, h: 844, shrink: 336 }]) {
  test.describe(`MC-2: клавиатура на ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('панель вкладок уходит, панель письма в экране, текста видно ≥ 7 строк', async ({ page }) => {
      await zenOff(page);
      await signInMobile(page, `mc2-write-${w}`);
      await page.goto('/');
      const area = page.locator('textarea').first();
      await area.waitFor({ state: 'visible', timeout: 30_000 });
      await area.click();
      await page.setViewportSize({ width: w, height: h - shrink });
      await expect.poll(navHidden(page), { timeout: 10_000, message: 'клавиатура не спрятала панель вкладок' }).toBe(true);

      await area.fill('раз два три четыре пять шесть семь восемь девять десять одиннадцать двенадцать');
      const toolbar = page.locator('[data-write-toolbar]');
      await expect(toolbar, 'панели письма не видно').toBeVisible();
      expect(await fullyInViewport(toolbar), 'панель письма за экраном').toBe(true);

      const inner = await page.evaluate(() => window.innerHeight);
      const box = await nav(page).boundingBox();
      expect(box && box.y >= inner - 1, `панель всё ещё в экране (y=${box?.y}, экран ${inner})`).toBe(true);

      const lines = await linesInEditor(page);
      expect(lines, `видно строк: ${lines.toFixed(1)}`).toBeGreaterThanOrEqual(7);
      await shot(page, `mc2-write-keyboard-${w}`);

      await page.setViewportSize({ width: w, height: h });
      await expect.poll(navShown(page), { timeout: 10_000, message: 'панель вкладок не вернулась' }).toBe(true);
      await expect.poll(() => fullyInViewport(area), { timeout: 10_000 }).toBe(true);
    });

    test('в чате клавиатура тоже убирает панель, композер в экране', async ({ page }) => {
      const account = await signInMobile(page, `mc2-ai-${w}`);
      grantAiConsent(account.uid);
      await page.reload();
      await unlockVaultIfAsked(page, account.password);
      await page.goto('/ai');
      const composer = page.locator('textarea').last();
      await composer.waitFor({ state: 'visible', timeout: 30_000 });
      await composer.click();
      await page.setViewportSize({ width: w, height: h - shrink });
      await expect.poll(navHidden(page), { timeout: 10_000, message: 'в чате панель вкладок не ушла' }).toBe(true);
      await expect.poll(() => fullyInViewport(composer), { timeout: 10_000, message: 'композер ушёл за экран' }).toBe(true);
      await shot(page, `mc2-ai-keyboard-${w}`);

      await page.setViewportSize({ width: w, height: h });
      await expect.poll(navShown(page), { timeout: 10_000, message: 'панель вкладок не вернулась в чате' }).toBe(true);
    });

    test('в «Заметках» с той же клавиатурой панель остаётся', async ({ page }) => {
      const account = await signInMobile(page, `mc2-archive-${w}`);
      await page.goto('/');
      const area = page.locator('textarea').first();
      await area.waitFor({ state: 'visible', timeout: 30_000 });
      await area.fill('Заметка для проверки панели вкладок в архиве.');
      await page.locator('[data-write-toolbar]').getByRole('button', { name: /^Сохранить$/ }).click();
      const finish = page.getByRole('dialog').last();
      await finish.getByRole('button', { name: /^Сохранить$/ }).click();
      await expect(page.locator('[aria-labelledby="finish-modal-title"]'), 'окно завершения не закрылось — сохранение не дошло')
        .toBeHidden({ timeout: 20_000 });

      await page.goto('/archive');
      await unlockVaultIfAsked(page, account.password);
      const search = page.locator('input').first();
      await search.click().catch(() => {});
      await page.setViewportSize({ width: w, height: h - shrink });
      await page.waitForTimeout(600);
      expect(await nav(page).getAttribute('aria-hidden'), 'панель вкладок ушла в архиве').not.toBe('true');
    });
  });
}
