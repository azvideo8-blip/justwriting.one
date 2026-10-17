// 0.10.0: мобильный макет открыт всем. Весь остальной мобильный набор ходит
// аккаунтами с ролью admin (право MB-1 выдавал харнесс), поэтому путь ОБЫЧНОГО
// человека не проверял ни один спек: вход с телефона → окна первого входа →
// запись → заметка в списке → телефонное руководство.
import { expect, test } from '@playwright/test';
import { createUser } from '../stand';
import { autoHandlers, login, openVaultFromBanner, shot, waitForNavigationSettled, zenOff } from './harness';

for (const [w, h] of [[360, 640], [390, 844]] as const) {
  test.describe(`0.10.0: обычный человек на телефоне ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('вход, запись, список и телефонное руководство — без права админа', async ({ page }) => {
      await zenOff(page);
      const account = await createUser(`v0100-regular-${w}`);
      await autoHandlers(page, account.password);
      await login(page, account);

      // Мобильный макет, а не десктоп: панель записи телефона и нижняя навигация.
      await page.goto('/');
      const editor = page.locator('textarea').first();
      await editor.waitFor({ state: 'visible', timeout: 30_000 });
      await expect(page.locator('[data-write-toolbar]'), 'обычный человек получил десктоп').toBeVisible();
      await expect(page.getByRole('button', { name: 'Заметки' })).toBeVisible();

      await editor.fill('Первая запись с телефона. Ещё фраза.');
      await page.locator('[data-write-toolbar]').getByRole('button', { name: /^Сохранить$/ }).click();
      const finish = page.locator('[aria-labelledby="finish-modal-title"]');
      await expect(finish).toBeVisible({ timeout: 15_000 });
      await finish.getByRole('button', { name: /^Сохранить$/ }).click();
      await expect(finish).toBeHidden({ timeout: 20_000 });
      await waitForNavigationSettled(page);

      await page.goto('/archive');
      await openVaultFromBanner(page, account.password);
      await expect(page.getByText('Первая запись с телефона.').first()).toBeVisible({ timeout: 20_000 });
      await shot(page, `v0100-regular-archive-${w}`);

      await page.goto('/guide');
      await expect(page.getByRole('heading', { level: 1, name: 'Телефон' })).toBeVisible({ timeout: 15_000 });
      await shot(page, `v0100-regular-guide-${w}`);
    });
  });
}

// /code-review 0.10.0: в мастере первого входа прозрачный input CheckboxRow
// лежал поверх ссылок в тексте согласия — «политика», «условия», «согласие»
// ставили галочку вместо того, чтобы открыться. Без автообработчиков харнесса:
// они проходят шаг согласия раньше теста. Пробное нажатие проверяет, что
// касание получает сама ссылка.
test.describe('0.10.0: ссылки в согласии первого входа', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('политика, условия и согласие на ИИ нажимаются, а не ставят галочку', async ({ page }) => {
    await zenOff(page);
    const account = await createUser('v0100-consent-links');
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(account.email);
    await page.locator('input[type="password"]').fill(account.password);
    await page.locator('input[type="password"]').press('Enter');
    const stepper = page.getByTestId('first-run-stepper');
    await expect(stepper).toBeVisible({ timeout: 90_000 });

    const links = stepper.locator('a[href="/privacy"], a[href="/terms"], a[href="/consent"]');
    await expect(links.first()).toBeVisible({ timeout: 20_000 });
    const n = await links.count();
    expect(n, 'на шаге согласия нет ссылок на документы').toBeGreaterThanOrEqual(3);
    for (let i = 0; i < n; i++) {
      const link = links.nth(i);
      if (!(await link.isVisible())) continue;
      await link.click({ trial: true, timeout: 3_000 });
    }
    // Ни одна галочка не поставилась сама собой.
    for (const box of await stepper.getByRole('checkbox').all()) expect(await box.isChecked()).toBe(false);
  });
});
