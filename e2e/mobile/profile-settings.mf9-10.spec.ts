// MF-9 + MF-10: «Профиль → Настройки → Открыть» ведёт в /settings (шестерни нет),
// у /settings есть липкая «‹ Профиль», которая возвращает в профиль; «Выйти» в
// профиле открывает окно подтверждения.
import { expect, test } from '@playwright/test';
import { shot, signInMobile, smallTargets } from './harness';

for (const [w, h] of [[390, 844], [360, 740]] as const) {
  test.describe(`MF-9/10 на ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('профиль → настройки → назад; «Выйти» — подтверждение', async ({ page }) => {
      await signInMobile(page, `mf910-${w}`);
      await page.goto('/me');
      await expect(page.getByRole('button', { name: /^Настройки$/ }), 'в шапке профиля осталась шестерня').toHaveCount(0);
      await shot(page, `mf9-profile-${w}`);
      await page.getByRole('button', { name: /^Открыть$/ }).click();
      await expect(page).toHaveURL(/\/settings$/);
      await expect(page.getByRole('dialog'), 'открылась панель редактора').toHaveCount(0);

      // mouse.wheel нет в мобильном WebKit — прокрутка напрямую.
      await page.evaluate(() => window.scrollTo(0, 1500));
      await page.waitForTimeout(400);
      const back = page.locator('main').getByRole('button', { name: /^Профиль$/ });
      await expect(back, '«‹ Профиль» не держится наверху').toBeInViewport();
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, `mf10-settings-${w}`);
      const small = (await smallTargets(page)).filter(s => /^(RU|EN)$/.test(s.label));
      expect(small, `RU/EN меньше 44 px: ${JSON.stringify(small)}`).toEqual([]);
      await back.click();
      await expect(page).toHaveURL(/\/me$/);

      await page.getByRole('button', { name: /^Выйти$/ }).click();
      await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 5_000 });
      await shot(page, `mf9-signout-confirm-${w}`);
    });
  });
}
