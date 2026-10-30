// Владелец 30.10: на десктопе серия («1 день») и «Последняя запись — … ·
// Продолжить» стояли двумя плашками посреди экрана над полем письма. Теперь —
// одна тихая строка по ширине поля: слева серия, справа подсказка.
// Сценарий: заметка вчера (часы браузера переведены на сутки вперёд), главный экран.
import { expect, test, devices } from '@playwright/test';
import { shot, signInMobile, zenOff } from './harness';

test.use({ ...devices['Desktop Chrome'], viewport: { width: 1550, height: 720 } });

test('серия и «Продолжить» — одной строкой по краям поля письма', async ({ page }) => {
  await zenOff(page);
  await signInMobile(page, 'desk-home-row');
  await page.goto('/');
  const editor = page.locator('textarea').first();
  await editor.waitFor({ state: 'visible', timeout: 30_000 });
  await editor.fill('Утро. Немного текста, чтобы назавтра была последняя запись и серия.');
  await page.keyboard.press('Control+s');
  await page.getByRole('dialog').last().getByRole('button', { name: /^Сохранить$/ }).click();
  await expect(page.locator('[aria-labelledby="finish-modal-title"]')).toBeHidden({ timeout: 20_000 });

  await page.clock.install({ time: new Date(Date.now() + 26 * 3600_000) });
  await page.goto('/');
  const row = page.getByTestId('home-status-row');
  await expect(row.getByTestId('streak-chip'), 'серии нет в строке').toBeVisible({ timeout: 30_000 });
  await expect(row.getByTestId('return-to-writing'), '«Продолжить» не в строке').toBeVisible({ timeout: 30_000 });
  await shot(page, 'desktop-home-row-1550');

  const r = (await row.boundingBox())!;
  const box = (await page.locator('textarea').first().locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]').boundingBox())!;
  const streak = (await row.getByTestId('streak-chip').boundingBox())!;
  const ret = (await row.getByTestId('return-to-writing').boundingBox())!;
  expect(r.y + r.height, 'строка не над полем письма').toBeLessThanOrEqual(box.y + 1);
  expect(Math.abs(streak.y - ret.y), 'серия и подсказка не в одной строке').toBeLessThan(16);
  expect(streak.x, 'серия левее поля').toBeGreaterThanOrEqual(box.x - 1);
  expect(ret.x + ret.width, 'подсказка правее поля').toBeLessThanOrEqual(box.x + box.width + 1);
});
