// MQ-3: черновик уже в редакторе — строка «Черновик восстановлен» с одним действием «Убрать»,
// без обрезки текста и с кнопками 44 px; «Сохранить» активна без начатой сессии.
import { expect, test } from '@playwright/test';
import { shot, signInMobile, waitForMobileSettled, zenOff } from './harness';

for (const { w, h } of [{ w: 360, h: 640 }, { w: 390, h: 844 }]) {
  test.describe(`MQ-3: баннер черновика на ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('после перезагрузки текст на месте, баннер не обрезан, «Сохранить» активна', async ({ page }) => {
      await zenOff(page);
      const account = await signInMobile(page, `mq3-draft-${w}`);
      await page.goto('/');
      await waitForMobileSettled(page, account.password);
      const area = page.locator('textarea').first();
      await area.waitFor({ state: 'visible', timeout: 30_000 });
      const text = 'Вечером тревожно. Не могу объяснить почему, просто сижу и пишу всё подряд.';
      await area.fill(text);
      // Локальное автосохранение на телефоне — через 5 с тишины.
      await page.waitForTimeout(7_000);

      await page.reload();
      await waitForMobileSettled(page, account.password);
      await expect(page.locator('textarea').first()).toHaveValue(text, { timeout: 30_000 });

      const banner = page.getByText('Черновик восстановлен');
      await expect(banner, 'баннер не показан').toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: 'Восстановить' }), 'у восстановленного черновика осталась «Восстановить»').toHaveCount(0);
      const remove = page.getByRole('button', { name: 'Убрать' });
      await expect(remove).toBeVisible();

      const m = await banner.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth, overflow: getComputedStyle(el).textOverflow }));
      expect(m.sw, `текст баннера обрезан: ${JSON.stringify(m)}`).toBeLessThanOrEqual(m.cw);
      expect(m.overflow).not.toBe('ellipsis');
      expect((await remove.boundingBox())!.height, '«Убрать» ниже 44 px').toBeGreaterThanOrEqual(44);
      await expect(page.locator('[data-write-toolbar]').getByRole('button', { name: /^Сохранить$/ }), '«Сохранить» неактивна').toBeEnabled();
      await shot(page, `mq3-draft-banner-${w}`);
    });
  });
}
