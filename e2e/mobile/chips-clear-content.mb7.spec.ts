// MB-7 (F-6): чип «Активность» (и «Синхронизация») висят на 32 px над нижней
// панелью. Пока main компенсировал только высоту панели, чип закрывал последнюю
// строку списка заметок, счётчик квоты в чате и «Выйти» в настройках.
import { expect, test } from '@playwright/test';
import { pickFreeFlow, shot, signInMobile, zenOff } from './harness';

test.use({ viewport: { width: 360, height: 640 } });

const TITLE = 'Запись для чипа активности';

/**
 * Главное для MB-7: список, прокрученный до конца, обязан заканчиваться ВЫШЕ
 * чипа. Мерить надо дно прокрутки (vh − padding-bottom у main), а не конкретную
 * строку: на коротком архиве из одной заметки строка и так на середине экрана,
 * и проверка была бы вакуумной.
 */
async function contentEndsAboveChip(page: import('@playwright/test').Page): Promise<{ contentBottom: number; chipTop: number; navTop: number }> {
  return page.evaluate(() => {
    const main = document.getElementById('main-content');
    const chipEl = document.querySelector('[aria-label="Журнал активности"]');
    const navEl = document.querySelector('[class*="--z-sidebar"]');
    if (!main || !chipEl || !navEl) throw new Error('нет чипа, панели или main');
    const pb = parseFloat(getComputedStyle(main).paddingBottom) || 0;
    return {
      contentBottom: Math.round(window.innerHeight - pb),
      chipTop: Math.round(chipEl.getBoundingClientRect().top),
      navTop: Math.round(navEl.getBoundingClientRect().top),
    };
  });
}

test.describe('MB-7: содержимое не прячется под чип над нижней панелью', () => {
  test('последняя строка архива не под чипом, «Выйти» в настройках тоже', async ({ page }) => {
    await zenOff(page);
    await signInMobile(page, 'mb7-chips');

    // Заметка с заголовком, чтобы строку было чем назвать.
    await page.getByRole('button', { name: /^Начать$/ }).click();
    expect(await pickFreeFlow(page), 'лист «Выбери режим» не открылся').toBe(true);
    const editor = page.locator('textarea').first();
    await editor.waitFor({ state: 'visible', timeout: 30_000 });
    await editor.fill('Одна строка для проверки отступа под чипом. Раз два три.');
    await page.getByRole('button', { name: /^Стоп$/ }).click();
    const finish = page.getByRole('dialog').first();
    await expect(finish).toBeVisible({ timeout: 15_000 });
    const titleInput = finish.getByLabel(/Название/).first();
    if (await titleInput.isVisible().catch(() => false)) await titleInput.fill(TITLE);
    await finish.getByRole('button', { name: /^Сохранить$/ }).click();
    await page.waitForTimeout(2_000);

    await page.getByRole('button', { name: 'Заметки' }).click();
    const row = page.getByText(TITLE).first();
    await expect(row, 'заметка не появилась в архиве').toBeVisible({ timeout: 20_000 });
    await row.scrollIntoViewIfNeeded();
    // Прокручиваем список в конец: именно последний рядок и закрывался чипом.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);

    const geometry = await page.evaluate(() => {
      const chipEl = document.querySelector('[aria-label="Журнал активности"]');
      const rows = Array.from(document.querySelectorAll('[class*="grid items-start gap-3 px-3 py-4"]'));
      const last = rows[rows.length - 1];
      if (!chipEl || !last) return null;
      const c = chipEl.getBoundingClientRect();
      const r = last.getBoundingClientRect();
      return { chipTop: Math.round(c.top), chipBottom: Math.round(c.bottom), rowTop: Math.round(r.top), rowBottom: Math.round(r.bottom) };
    });
    const clearance = await contentEndsAboveChip(page);
    console.warn('[mb7] архив', JSON.stringify(geometry), 'до дна прокрутки', JSON.stringify(clearance));
    expect(geometry, 'не нашлись чип и строка').not.toBeNull();
    expect(clearance.contentBottom, `список, прокрученный до конца, уходит под чип: дно ${clearance.contentBottom} > чип ${clearance.chipTop}`)
      .toBeLessThanOrEqual(clearance.chipTop);
    await shot(page, 'mb7-archive-last-row-360');

    await page.goto('/settings');
    const exit = page.getByRole('button', { name: /^Выйти$/ }).first();
    await expect(exit, 'кнопки «Выйти» нет на /settings').toBeVisible({ timeout: 20_000 });
    await exit.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const settings = await page.evaluate(() => {
      const chipEl = document.querySelector('[aria-label="Журнал активности"]');
      const btns = Array.from(document.querySelectorAll('button')).filter(b => /^Выйти$/.test((b.textContent ?? '').trim()));
      const last = btns[btns.length - 1];
      if (!chipEl || !last) return null;
      const c = chipEl.getBoundingClientRect();
      const r = last.getBoundingClientRect();
      return { chipTop: Math.round(c.top), exitTop: Math.round(r.top), exitBottom: Math.round(r.bottom), h: Math.round(r.height) };
    });
    const clearanceSettings = await contentEndsAboveChip(page);
    console.warn('[mb7] настройки', JSON.stringify(settings), 'до дна прокрутки', JSON.stringify(clearanceSettings));
    expect(settings, 'не нашлись чип и «Выйти»').not.toBeNull();
    // Высота «Выйти» (38 px) — это F-18/MN-2, цели касания: отдельная правка
    // следующего batches, здесь проверяется только перекрытие чипом.
    expect(clearanceSettings.contentBottom, 'низ содержимого ушёл под чип')
      .toBeLessThanOrEqual(clearanceSettings.chipTop);
    await shot(page, 'mb7-settings-sign-out-360');
  });
});
