// MB-3 (F-2): панель письма влезает — «Стоп» целиком в экране на 320, 390 и в
// ландшафте, и тап по ней открывает окно завершения. Дзен выключен, чтобы
// проверка была про геометрию панели, а не про дзен (это MB-2).
import { expect, test } from '@playwright/test';
import { fullyInViewport, shot, signInMobile, zenOff } from './harness';

const CASES = [
  { tag: '320x568', viewport: { width: 320, height: 568 } },
  { tag: '390x844', viewport: { width: 390, height: 844 } },
  { tag: '430x932', viewport: { width: 430, height: 932 } },
  { tag: 'landscape844x390', viewport: { width: 844, height: 390 } },
];

for (const c of CASES) {
  test.describe(`MB-3: панель письма на ${c.tag}`, () => {
    test.use({ viewport: c.viewport });

    test('«Стоп» целиком в экране, тап открывает окно завершения', async ({ page }) => {
      await zenOff(page);
      await signInMobile(page, 'mb3-fit');

    // MR-6 (направление A): редактор открыт сразу, «Начать» и лист режима не нужны.
    await page.goto('/');

      const editor = page.locator('textarea').first();
      await editor.waitFor({ state: 'visible', timeout: 30_000 });
      await editor.click();
      await editor.pressSequentially('проверка ширины панели на телефоне', { delay: 5 });

      const stop = page.locator('[data-write-toolbar]').getByRole('button', { name: /^Сохранить$/ });
      await expect(stop).toBeVisible({ timeout: 10_000 });
      const box = await stop.boundingBox();
      expect(box, 'у «Стоп» нет геометрии').not.toBeNull();
      // Снимок — до проверок: он нужен и в зелёном прогоне («после»), и в
      // красном («до»), а после упавшего expect до него уже не дойти.
      await shot(page, `mb3-toolbar-${c.tag}`);
      const inside = await fullyInViewport(stop);
      const edges = box ? `x=${Math.round(box.x)}..${Math.round(box.x + box.width)} из ${c.viewport.width}` : '';
      expect(inside, `«Стоп» за краем экрана (${edges})`).toBe(true);

      await stop.click();
      const dialog = page.getByRole('dialog').first();
      await expect(dialog, 'тап по «Стоп» не открыл окно завершения').toBeVisible({ timeout: 10_000 });
      // Окно не должно упираться за край: проверяем его ширину на той же ширине экрана.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `появился горизонтальный скролл: +${overflow}px`).toBeLessThanOrEqual(0);
    });
  });
}
