// 0.10.1 (просьба владельца): листы закрываются свайпом вниз, короткий
// свайп возвращает лист на место. Лист «⋯» в «Заметках» — обычный лист.
import { expect, test, type Page } from '@playwright/test';
import { signInMobile, zenOff } from './harness';

test.use({ viewport: { width: 390, height: 844 } });

// Приёмка ai-privacy (UI-1): лист тянется только пальцем, мышью — нет. Свайп —
// настоящими касаниями через CDP (pointerType = touch), а не page.mouse.
async function touchSwipe(page: Page, x: number, y: number, dy: number, steps: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * i) / steps }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

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

  await touchSwipe(page, x, y, 30, 6);
  await page.waitForTimeout(500);
  await expect(sheet, 'короткий свайп закрыл лист').toBeVisible();

  await touchSwipe(page, x, y, 260, 12);
  await expect(sheet, 'длинный свайп не закрыл лист').toBeHidden({ timeout: 3_000 });
});

test('лист «⋯» в «Заметках»: мышью лист не утаскивается (UI-1)', async ({ page }) => {
  await zenOff(page);
  await signInMobile(page, 'v0101-sheet-mouse');
  await page.goto('/archive');
  await page.getByRole('button', { name: 'Ещё' }).click();
  const sheet = page.getByRole('dialog').last();
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(400);
  const box = (await sheet.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 24);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 284, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await expect(sheet, 'мышь утащила лист').toBeVisible();
});
