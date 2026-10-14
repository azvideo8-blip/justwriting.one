// MP-4: на телефоне полоса «чат 59/60 · рассуждения 5/5» больше не стоит между
// композером и вкладками — числа переехали в лист «⋯» шапки диалога.
import { expect, test } from '@playwright/test';
import { grantAiConsent, shot, signInMobile, unlockVaultIfAsked } from './harness';

for (const { w, h } of [{ w: 390, h: 844 }, { w: 360, h: 640 }]) {
  test.describe(`MP-4: лимит в листе «⋯» на ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('под композером полосы нет, числа — в «⋯»', async ({ page }) => {
      const acc = await signInMobile(page, `mp4-quota-${w}`);
      grantAiConsent(acc.uid);
      await page.reload();
      await unlockVaultIfAsked(page, acc.password);

      await page.goto('/ai');
      const composer = page.locator('textarea').last();
      await composer.waitFor({ state: 'visible', timeout: 30_000 });
      const text = `МП4-${Date.now().toString(36)}`;
      await composer.fill(text);
      await page.getByRole('button', { name: /Отправить/ }).click();
      await expect(page.getByText(text).first(), 'ход не отправлен').toBeVisible({ timeout: 40_000 });

      // Композер: область вокруг поля ввода не должна содержать подписей лимита.
      const underComposer = await page.evaluate(() => {
        const area = document.querySelectorAll('textarea');
        const el = area[area.length - 1];
        const root = el?.closest('div[class*="shrink-0"]');
        return root ? (root.textContent ?? '') : '';
      });
      expect(underComposer, `под композером осталась полоса лимита: ${underComposer.slice(0, 80)}`)
        .not.toMatch(/рассуждения/);
      await shot(page, `mp4-composer-${w}`);

      const more = page.getByRole('button', { name: 'Ещё' });
      await expect(more, '«⋯» шапки не появилась').toBeVisible({ timeout: 15_000 });
      await more.click();
      const sheet = page.getByRole('dialog').filter({ hasText: 'Осталось сегодня' }).first();
      await expect(sheet, 'в листе «⋯» нет строки об остатке').toBeVisible({ timeout: 15_000 });
      await expect(sheet.getByText(/\d+\/\d+/).first()).toBeVisible();
      await shot(page, `mp4-quota-sheet-${w}`);
    });
  });
}
