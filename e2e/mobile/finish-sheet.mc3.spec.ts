// MC-3: «Записано.» на телефоне — полноэкранный лист с одной мыслью вместо
// диалога с двумя десятками контролов.
import { expect, test, type Page } from '@playwright/test';
import { fullyInViewport, openVaultFromBanner, shot, signInMobile, zenOff, type Account } from './harness';

// Тридцать слов без повторов: подсказки тегов считываются из текста, и пустой
// список подсказок — то, при каком раскладе лист держит бюджет контролов.
const TEXT = 'Глина обжиг печка глазурь круг вода руки пыль форма трещина тень запах дым песок камень лето вечер тишина шаг свет окно стол ночь дождь крыша';

async function openFinish(page: Page): Promise<Page> {
  await page.goto('/');
  const area = page.locator('textarea').first();
  await area.waitFor({ state: 'visible', timeout: 30_000 });
  await area.fill(TEXT);
  await page.getByRole('button', { name: /^Готово$/ }).click();
  const sheet = page.locator('[aria-labelledby="finish-modal-title"]');
  await expect(sheet, 'лист завершения не открылся').toBeVisible({ timeout: 15_000 });
  return page;
}

for (const { w, h } of [{ w: 360, h: 640 }, { w: 390, h: 844 }]) {
  test.describe(`MC-3: лист «Записано.» на ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('лист закрывает вьюпорт, контролов ≤ 14, «Сохранить» без прокрутки', async ({ page }) => {
      await zenOff(page);
      await signInMobile(page, `mc3-sheet-${w}`);
      await openFinish(page);

      const sheet = page.locator('[aria-labelledby="finish-modal-title"]');
      await expect.poll(async () => {
        const b = await sheet.boundingBox();
        return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null;
      }, { timeout: 10_000, message: 'лист не занимает весь вьюпорт' }).toEqual({ x: 0, y: 0, w, h });

      const controls = await page.locator('[aria-labelledby="finish-modal-title"]').locator('button, input, [role="button"]').count();
      expect(controls, `контролов в листе: ${controls}`).toBeLessThanOrEqual(14);

      const save = page.getByRole('button', { name: /^Сохранить$/ });
      await expect(save).toBeVisible();
      expect(await fullyInViewport(save), '«Сохранить» уехала за экран').toBe(true);
      await shot(page, `mc3-finish-sheet-${w}`);

      // Старины листа: заголовка со словами и графиком скорости здесь нет.
      await expect(sheet.getByText(/Скорость по времени/), 'в листе осталась карточка скорости').toHaveCount(0);
      await expect(sheet.getByText(/ДНЕЙ ПОДРЯД|дней подряд/), 'в листе остался стрик').toHaveCount(0);
    });

    test('сохранение доходит до архива, панель закрылась сама', async ({ page }) => {
      await zenOff(page);
      const account: Account = await signInMobile(page, `mc3-save-${w}`);
      await openFinish(page);
      const title = `Обжиг ${w}`;
      await page.getByLabel(/Название/).first().fill(title);

      await page.getByRole('button', { name: /^Сохранить$/ }).click();
      await expect(page.locator('[aria-labelledby="finish-modal-title"]'), 'лист не закрылся — сохранение не дошло')
        .toBeHidden({ timeout: 20_000 });

      await page.goto('/archive');
      await openVaultFromBanner(page, account.password);
      await expect(page.getByText(title).first(), 'заметка не появилась в архиве').toBeVisible({ timeout: 20_000 });
    });

    test('«×» возвращает к тексту без сохранения', async ({ page }) => {
      await zenOff(page);
      await signInMobile(page, `mc3-close-${w}`);
      await openFinish(page);
      await page.getByRole('button', { name: /^Закрыть$/ }).click();
      await expect(page.locator('[aria-labelledby="finish-modal-title"]'), '«×» не закрыла лист').toBeHidden({ timeout: 15_000 });
      await expect(page.locator('textarea').first()).toHaveValue(TEXT);
    });
  });
}
