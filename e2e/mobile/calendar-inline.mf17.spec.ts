// MF-17: «⋯ → Календарь и статистика» на телефоне ничего не показывало — лист
// открывался и тут же закрывался (та же передача листов, что MF-11). Теперь —
// встроенная панель над заметками с «×»; живёт, пока её не закроют.
import { expect, test, type Page } from '@playwright/test';
import { openVaultFromBanner, shot, signInMobile, zenOff } from './harness';

async function saveNote(page: Page, text: string): Promise<void> {
  await page.goto('/');
  const editor = page.locator('textarea').first();
  await editor.waitFor({ state: 'visible', timeout: 30_000 });
  await editor.fill(text);
  await page.locator('[data-write-toolbar]').getByRole('button', { name: /^Сохранить$/ }).click();
  const finish = page.locator('[aria-labelledby="finish-modal-title"]');
  await expect(finish).toBeVisible({ timeout: 15_000 });
  await finish.getByRole('button', { name: /^Сохранить$/ }).click();
  await expect(finish).toBeHidden({ timeout: 20_000 });
}

for (const [w, h] of [[360, 740], [390, 844]] as const) {
  test.describe(`MF-17: календарь над заметками на ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('«⋯ → Календарь» — панель над первой заметкой; «×» прячет; заметка туда-обратно её не закрывает', async ({ page }) => {
      await zenOff(page);
      const account = await signInMobile(page, `mf17-${w}`);
      await saveNote(page, 'Календарная заметка про глину. Вторая фраза.');
      await page.goto('/archive');
      await openVaultFromBanner(page, account.password);
      const firstNote = page.getByText('Календарная заметка про глину.').first();
      await expect(firstNote).toBeVisible({ timeout: 20_000 });

      await page.getByRole('button', { name: 'Ещё' }).click();
      await page.getByRole('button', { name: /Календарь и статистика/ }).click();
      const panel = page.getByTestId('archive-calendar-panel');
      await expect(panel, 'календарь не появился').toBeVisible({ timeout: 5_000 });
      await page.waitForTimeout(800);
      await expect(panel, 'календарь закрылся сам').toBeVisible();
      const pBox = (await panel.boundingBox())!;
      const nBox = (await firstNote.boundingBox())!;
      expect(pBox.y, 'панель не над первой заметкой').toBeLessThan(nBox.y);
      await shot(page, `mf17-calendar-${w}`);

      // Пункт меню при открытой панели — «Скрыть календарь».
      await page.getByRole('button', { name: 'Ещё' }).click();
      await expect(page.getByRole('button', { name: /Скрыть календарь/ })).toBeVisible();
      await page.getByRole('dialog').getByRole('button', { name: 'Закрыть' }).first().click();

      console.warn(`[mf17 ${w}] высота панели: ${Math.round(pBox.height)} px при окне ${h}`);
      // Заметка туда и обратно — панель на месте. Панель высокая, заметка ниже
      // сгиба — сначала в середину экрана (иначе клик упирается в нижнюю панель).
      await firstNote.evaluate(el => el.scrollIntoView({ block: 'center' }));
      await firstNote.click();
      const reader = page.getByRole('dialog').filter({ hasText: 'Вторая фраза' }).first();
      await expect(reader).toBeVisible({ timeout: 15_000 });
      await page.goBack();
      await expect(reader).toBeHidden({ timeout: 10_000 });
      await expect(panel, 'после заметки панель пропала').toBeVisible();

      await panel.getByRole('button', { name: 'Закрыть' }).click();
      await expect(panel).toHaveCount(0);
    });
  });
}
