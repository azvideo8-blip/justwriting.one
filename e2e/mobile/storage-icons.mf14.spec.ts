// MF-14: значки «облако · устройство · разбор» под временем в списке и в строке
// названия карточки сетки; на 360 длинное название режется, значки видны.
import { expect, test, type Page } from '@playwright/test';
import { openVaultFromBanner, shot, signInMobile, zenOff } from './harness';

test.use({ viewport: { width: 360, height: 740 } });

async function saveNote(page: Page, text: string, title: string): Promise<void> {
  await page.goto('/');
  const editor = page.locator('textarea').first();
  await editor.waitFor({ state: 'visible', timeout: 30_000 });
  await editor.fill(text);
  await page.locator('[data-write-toolbar]').getByRole('button', { name: /^Сохранить$/ }).click();
  const finish = page.locator('[aria-labelledby="finish-modal-title"]');
  await expect(finish).toBeVisible({ timeout: 15_000 });
  const field = finish.getByLabel(/Название/).first();
  if (await field.isVisible().catch(() => false)) await field.fill(title);
  await finish.getByRole('button', { name: /^Сохранить$/ }).click();
  await expect(finish).toBeHidden({ timeout: 20_000 });
}

test('MF-14: значки видны в списке и в сетке при длинном названии', async ({ page }) => {
  await zenOff(page);
  const account = await signInMobile(page, 'mf14-icons');
  await saveNote(page, 'Глина сохнет быстрее, чем кажется. Круг крутят медленно.', 'Очень длинное название заметки про глину, круг и глазурь');
  await page.goto('/archive');
  await openVaultFromBanner(page, account.password);

  const icons = page.locator('[data-storage-state]').first();
  await expect(icons, 'в строке нет значков').toBeVisible({ timeout: 20_000 });
  await expect(icons).toHaveAttribute('aria-label', /на устройстве/);
  await shot(page, 'mf14-list-360');

  await page.getByRole('button', { name: 'Ещё' }).click();
  await page.getByRole('button', { name: /^Сетка$/ }).click();
  await page.getByRole('button', { name: 'Закрыть' }).first().click();
  const cardIcons = page.locator('[data-storage-state]').first();
  await expect(cardIcons).toBeVisible();
  const vw = 360;
  const box = (await cardIcons.boundingBox())!;
  expect(box.x + box.width, `значки за краем: ${box.x + box.width} > ${vw}`).toBeLessThanOrEqual(vw);
  const titleBox = (await page.getByRole('heading', { level: 2 }).first().boundingBox())!;
  expect(Math.abs(titleBox.y + titleBox.height / 2 - (box.y + box.height / 2)), 'значки не в строке названия').toBeLessThan(12);
  await shot(page, 'mf14-grid-360');
});
