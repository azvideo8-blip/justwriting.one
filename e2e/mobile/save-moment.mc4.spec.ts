// MC-4: после «Сохранить» на телефоне — не тост над панелью инструментов, а
// тихая строка «Записано · N слов» в шапке на 1,2 с; серия догоняет на месте.
import { expect, test, type Page } from '@playwright/test';
import { shot, signInMobile, zenOff, type Account } from './harness';

async function saveNote(page: Page, text: string): Promise<void> {
  await page.goto('/');
  const area = page.locator('textarea').first();
  await area.waitFor({ state: 'visible', timeout: 30_000 });
  await area.fill(text);
  await page.locator('[data-write-toolbar]').getByRole('button', { name: /^Сохранить$/ }).click();
  const sheet = page.locator('[aria-labelledby="finish-modal-title"]');
  await expect(sheet, 'лист завершения не открылся').toBeVisible({ timeout: 15_000 });
  await sheet.getByRole('button', { name: /^Сохранить$/ }).click();
  await expect(page.locator('[aria-labelledby="finish-modal-title"]'), 'лист не закрылся — сохранение не дошло')
    .toBeHidden({ timeout: 20_000 });
}

const TEXT = 'Глина обжиг печка глазурь круг вода руки пыль форма трещина тень запах дым песок камень лето вечер тишина шаг свет окно стол ночь дождь крыша песок глина';

for (const { w, h } of [{ w: 390, h: 844 }]) {
  test.describe(`MC-4: момент сохранения на ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('строка вверху, тоста над панелью нет, через 2 с шапка обычная', async ({ page }) => {
      await zenOff(page);
      const account: Account = await signInMobile(page, `mc4-moment-${w}`);
      await page.goto('/');
      await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 30_000 });

      const toolbar = page.locator('[data-write-toolbar]');
      const toolbarBox = await toolbar.boundingBox();
      expect(toolbarBox, 'панели письма нет').not.toBeNull();

      await saveNote(page, TEXT);

      const line = page.getByTestId('save-moment');
      await expect(line, 'строки «Записано · …» нет').toBeVisible({ timeout: 500 });
      const box = await line.boundingBox();
      expect(box && box.y < 80, `строка не в шапке (y=${box?.y})`).toBe(true);
      expect(box && box.y + box.height <= (toolbarBox?.y ?? 0) + 1, 'строка залезла на панель письма').toBe(true);
      await shot(page, `mc4-save-moment-${w}`);

      // Ни один role=status не лежит поверх панели инструментов.
      const overlap = await page.evaluate((tb) => {
        const boxes: { x: number; y: number; width: number; height: number }[] = [];
        for (const el of Array.from(document.querySelectorAll('[role="status"]'))) {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          const hit = !(r.right < tb.x || r.left > tb.x + tb.width || r.bottom < tb.y || r.top > tb.y + tb.height);
          if (hit) boxes.push({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
        }
        return boxes;
      }, toolbarBox!);
      expect(overlap, `role=status поверх панели письма: ${JSON.stringify(overlap)}`).toEqual([]);

      // «Заметка сохранена» больше не всплывает.
      await expect(page.getByText(/Заметка сохранена/)).toHaveCount(0);

      await expect.poll(async () => (await page.getByTestId('save-moment').count()) === 0, {
        timeout: 5_000, message: 'строка не исчезла через 1,2 с',
      }).toBe(true);

      // Свежий аккаунт: серия появилась и показана в токене.
      const token = page.getByText(/^1 день/);
      await expect(token, 'токен серии не показал «1 день»').toBeVisible({ timeout: 5_000 });
      await shot(page, `mc4-after-moment-${w}`);
      void account;
    });
  });
}
