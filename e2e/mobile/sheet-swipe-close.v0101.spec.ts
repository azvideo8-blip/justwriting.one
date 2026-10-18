// 0.10.1 (просьба владельца): листы закрываются свайпом вниз, короткий
// свайп возвращает лист на место. Лист «⋯» в «Заметках» — обычный лист.
import { expect, test } from '@playwright/test';
import { signInMobile, zenOff } from './harness';

test.use({ viewport: { width: 390, height: 844 } });

test('лист «⋯» в «Заметках»: короткий свайп — остаётся, длинный — закрывается', async ({ page }) => {
  await zenOff(page);
  await signInMobile(page, 'v0101-sheet-swipe');
  await page.goto('/archive');
  await page.getByRole('button', { name: 'Ещё' }).click();
  const sheet = page.getByRole('dialog').last();
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(400); // въезд листа

  const box = (await sheet.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 24;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 30, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await expect(sheet, 'короткий свайп закрыл лист').toBeVisible();

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 260, { steps: 12 });
  await page.mouse.up();
  await expect(sheet, 'длинный свайп не закрыл лист').toBeHidden({ timeout: 3_000 });
});
