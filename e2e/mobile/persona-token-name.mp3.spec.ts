// MP-3: имя собеседника в мобильной шапке видно целиком — роль больше не стоит
// рядом и не режет имя («Г…»). Роль осталась второй строкой листа персон.
import { expect, test } from '@playwright/test';
import { shot, signInMobile, zenOff } from './harness';

for (const { w, h } of [{ w: 375, h: 667 }, { w: 390, h: 844 }, { w: 360, h: 640 }]) {
  test.describe(`MP-3: токен персоны на ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('«Группа консультантов» читается целиком, роли в токене нет', async ({ page }) => {
      await zenOff(page);
      await signInMobile(page, `mp3-token-${w}`);
      await page.goto('/ai');

      const token = page.getByRole('button', { name: /Группа консультантов/ }).first();
      await expect(token, 'токена персоны не видно').toBeVisible({ timeout: 20_000 });
      await expect(token, 'в токене осталась роль').not.toContainText('многогранная перспектива');

      const measure = await token.evaluate((el) => {
        const name = el.lastElementChild as HTMLElement | null;
        return name ? { scrollWidth: name.scrollWidth, clientWidth: name.clientWidth, text: name.textContent ?? '' } : null;
      });
      expect(measure, 'в токене нет подписи имени').not.toBeNull();
      expect(measure!.text, 'подписана не та строка').toContain('Группа консультантов');
      expect(measure!.scrollWidth, `имя обрезано: ${measure!.scrollWidth} > ${measure!.clientWidth}`)
        .toBeLessThanOrEqual(measure!.clientWidth);
      await shot(page, `mp3-header-token-${w}`);

      await token.click();
      const sheet = page.getByRole('dialog').filter({ hasText: 'Группа консультантов' }).first();
      await expect(sheet, 'лист персон не открылся').toBeVisible({ timeout: 15_000 });
      await expect(sheet.getByText('многогранная перспектива').first(), 'роли нет в листе персон').toBeVisible();
      await shot(page, `mp3-persona-sheet-${w}`);
    });
  });
}
