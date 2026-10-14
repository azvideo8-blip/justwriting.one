// MR-11: все цели касания на четырёх мобильных экранах — не меньше 44 px.
// Проверка идёт на 390 и 320: на 320 часть целей сжимается первой.
import { expect, test } from '@playwright/test';
import { dismissFirstLoginDialogs, openVaultFromBanner, shot, signInMobile, smallTargets, zenOff } from './harness';

const SIZES = [{ w: 390, h: 844 }, { w: 320, h: 568 }];

for (const { w, h } of SIZES) {
  test.describe(`MR-11: цели касания на ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('на «Писать», «Заметки», «ИИ» и «Я» нет целей меньше 44 px', async ({ page }) => {
      await zenOff(page);
      const account = await signInMobile(page, `mr11-${w}`);

      // Собираем со всех четырёх экранов сразу: падение на первом же скрывало бы,
      // что ещё осталось на «ИИ» и «Я».
      const offenders: Record<string, unknown> = {};
      for (const path of ['/', '/archive', '/ai', '/me']) {
        await page.goto(path);
        // Окна первого запуска приезжают с задержкой: на WebKit модальник
        // «Включить синхронизацию» ещё висел над экраном, и в нарушители
        // попадали его кнопки, а не экран.
        await dismissFirstLoginDialogs(page, true, 8_000);
        await openVaultFromBanner(page, account.password);
        await page.waitForTimeout(700);
        const small = await smallTargets(page);
        if (small.length) offenders[path] = small;
        await shot(page, `mr11-${path.replace(/\//g, '') || 'home'}-${w}`);
      }
      expect(offenders, `мелкие цели: ${JSON.stringify(offenders)}`).toEqual({});
    });

    test('skip-link в фокусе — цель не меньше 44 px, ячейки heatmap — не кнопки', async ({ page }) => {
      await zenOff(page);
      await signInMobile(page, `mr11-skip-${w}`);

      const skip = page.getByRole('link', { name: /Перейти к содержимому/ });
      await expect(skip).toHaveCount(1);
      await skip.focus();
      const box = await skip.boundingBox();
      expect(box, 'у skip-link в фокусе нет геометрии').not.toBeNull();
      expect(box!.height, `skip-link в фокусе ниже 44 px: ${Math.round(box!.height)}`).toBeGreaterThanOrEqual(43.5);
      expect(box!.width, `skip-link в фокусе уже 44 px: ${Math.round(box!.width)}`).toBeGreaterThanOrEqual(43.5);

      // Тепловая карта: 15×15 ячеек не должны притворяться кнопками.
      await page.goto('/me');
      const heatmap = page.getByTestId('heatmap');
      await expect(heatmap, 'тепловой карты на «Я» нет').toBeVisible({ timeout: 20_000 });
      await expect(heatmap.locator('[role="button"]'), 'ячейки heatmap снова кнопки').toHaveCount(0);
      expect(await heatmap.locator('[role="img"]').count(), 'у ячеек heatmap нет роли img')
        .toBeGreaterThan(0);
    });
  });
}
