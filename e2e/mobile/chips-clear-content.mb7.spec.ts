// MB-7 (F-6): содержимое не прячется под плавающими чипами над нижней панелью.
//
// MR-4 сами чипы («Активность», «Синхронизация») удалил — их состояние переехало
// в строки «Профиля», а на вкладке «Профиль» загорается точка. Проверка поэтому
// переформулирована: чипов над панелью больше нет ни на одном экране, а последний
// рядок списка при прокрутке в самый конец остаётся над панелью.
import { expect, test } from '@playwright/test';
import { shot, signInMobile, zenOff } from './harness';

const TITLE = 'Запись для отступа под панелью';

/** Дно прокручиваемой области и верх панели: рядок обязан помещаться между ними. */
async function clearance(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const nav = document.querySelector('nav');
    const main = document.getElementById('main-content');
    if (!nav || !main) return null;
    return {
      navTop: Math.round(nav.getBoundingClientRect().top),
      mainBottom: Math.round(main.getBoundingClientRect().bottom),
      paddingBottom: parseFloat(getComputedStyle(main).paddingBottom) || 0,
    };
  });
}

test.use({ viewport: { width: 360, height: 640 } });

test.describe('MB-7: ничего не висит над нижней панелью', () => {
  test('чипов нет, последняя строка архива не под панелью', async ({ page }) => {
    await zenOff(page);
    await signInMobile(page, 'mb7-clearance');

    // Направление A (MR-6): редактор открыт сразу, «Начать» больше не нужно.
    const editor = page.locator('textarea').first();
    await editor.waitFor({ state: 'visible', timeout: 30_000 });
    await editor.fill('Одна строка для проверки отступа под панелью. Раз два три.');
    await page.getByRole('button', { name: /^Готово$/ }).click();
    const finish = page.getByRole('dialog').first();
    await expect(finish).toBeVisible({ timeout: 15_000 });
    const titleInput = finish.getByLabel(/Название/).first();
    if (await titleInput.isVisible().catch(() => false)) await titleInput.fill(TITLE);
    await finish.getByRole('button', { name: /^Сохранить$/ }).click();
    await page.waitForTimeout(2_000);

    for (const path of ['/archive', '/settings', '/ai']) {
      await page.goto(path);
      await expect(page.locator('[aria-label="Журнал активности"]'), `чип журнала вернулся на ${path}`).toHaveCount(0);
      await expect(page.locator('[aria-label="Синхронизация"]'), `чип синхронизации вернулся на ${path}`).toHaveCount(0);
    }

    await page.goto('/archive');
    const row = page.getByText(TITLE).first();
    await expect(row, 'заметка не появилась в архиве').toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);
    const gap = await clearance(page);
    expect(gap, 'не нашлись панель и main').not.toBeNull();
    // Отступ снизу обязан покрывать панель (56 px) плюс safe area.
    expect(gap!.paddingBottom, `отступ main слишком мал: ${gap!.paddingBottom} px`).toBeGreaterThanOrEqual(56);
    const box = await row.boundingBox();
    expect(box, 'у строки нет геометрии').not.toBeNull();
    expect(box!.y + box!.height, `последняя строка ушла под панель (${Math.round(box!.y + box!.height)} > ${gap!.navTop})`)
      .toBeLessThanOrEqual(gap!.navTop + 1);
    await shot(page, 'mb7-archive-last-row-360');
  });
});
