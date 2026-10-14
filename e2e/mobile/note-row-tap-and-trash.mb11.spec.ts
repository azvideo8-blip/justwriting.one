// MB-11 (F-24, F-25) + закрытие B4 из аудита Fable: одиночный тап по строке
// открывает заметку, а корзина на телефоне существует под именем «Удалить
// заметку» в листе действий. Таблица «ярлык → тост → что произошло» печатается в
// вывод прогона: она идёт в отчёт.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { shot, signInMobile, zenOff } from './harness';

test.use({ viewport: { width: 360, height: 640 } });

async function toasts(page: Page): Promise<string[]> {
  const texts = await page.locator('[role="status"], [role="alert"]').allInnerTexts().catch(() => []);
  return texts.map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(-2);
}

async function saveNote(page: Page, text: string, title: string): Promise<void> {
    // MR-6 (направление A): редактор открыт сразу, «Начать» и лист режима не нужны.
    await page.goto('/');
  const editor = page.locator('textarea').first();
  await editor.waitFor({ state: 'visible', timeout: 30_000 });
  await editor.fill(text);
  await page.getByRole('button', { name: /^Готово$/ }).click();
  const finish = page.getByRole('dialog').first();
  await expect(finish).toBeVisible({ timeout: 15_000 });
  const titleInput = finish.getByLabel(/Название/).first();
  if (await titleInput.isVisible().catch(() => false)) await titleInput.fill(title);
  await finish.getByRole('button', { name: /^Сохранить$/ }).click();
  await page.waitForTimeout(1_500);
}

/** Предпросмотр заметки — панель .glass-panel, не role=dialog. */
function previewPanel(page: Page): Locator {
  return page.locator('.glass-panel');
}

test.describe('MB-11: один тап, корзина и B4', () => {
  test('одиночный тап по заголовку открывает заметку', async ({ page }) => {
    await zenOff(page);
    await signInMobile(page, 'mb11-tap');
    await saveNote(page, 'Проверка одиночного тапа. Раз два три.', 'Запись про тап');

    await page.getByRole('button', { name: 'Заметки' }).click();
    const title = page.getByText('Запись про тап').first();
    await expect(title, 'заметка не появилась в архиве').toBeVisible({ timeout: 20_000 });

    await title.click();
    const preview = previewPanel(page);
    await expect(preview, 'одиночный тап по заголовку не открыл заметку').toBeVisible({ timeout: 10_000 });
    const openedText = await preview.innerText().catch(() => '');
    console.warn('[mb11] после тапа открыто:', openedText.replace(/\s+/g, ' ').slice(0, 140));
    expect(openedText, 'тап открыл не заметку').toContain('Проверка одиночного тапа');
    await shot(page, 'mb11-one-tap-opens-360');
  });

  test('корзина на телефоне reachable: «Удалить заметку» ведёт в корзину (F-25)', async ({ page }) => {
    await zenOff(page);
    await signInMobile(page, 'mb11-trash');
    await saveNote(page, 'Первая для корзины.', 'Первая для корзины');

    await page.getByRole('button', { name: 'Заметки' }).click();
    const firstRow = page.getByText('Первая для корзины').first();
    await expect(firstRow).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /Действия с заметкой/ }).first().click();
    const sheet = page.getByRole('dialog').first();

    const labels = (await sheet.locator('button').allInnerTexts()).map(x => x.trim()).filter(Boolean);
    console.warn('[mb11] ярлыки листа действий:', JSON.stringify(labels));
    // F-25: отдельного пункта «В корзину» в листе нет — корзина на телефоне
    // reachable как «Удалить заметку» (тот же handleTrashSession, что и на
    // десктопе), а не как «Удалить локальную копию» / «Удалить облачную копию».
    expect(labels).toContain('Удалить заметку');
    expect(labels.some(l => /В корзину/i.test(l)), 'в листе появился бы дубль корзины').toBe(false);

    await sheet.getByRole('button', { name: /^Удалить заметку$/ }).click();
    const confirm = page.getByRole('dialog').filter({ hasText: /Удалить эту заметку/ }).first();
    await expect(confirm, 'подтверждение удаления не появилось').toBeVisible({ timeout: 10_000 });
    const confirmButtons = (await confirm.locator('button').allInnerTexts()).map(x => x.trim()).filter(Boolean);
    console.warn('[mb11] кнопки подтверждения:', JSON.stringify(confirmButtons));
    await confirm.getByRole('button', { name: confirmButtons[confirmButtons.length - 1] ?? /Удалить/ }).click();

    // Тост — это и есть подтверждение: StorageService.trashDocument + «в корзину».
    await expect
      .poll(async () => (await toasts(page)).join(' | '), { timeout: 15_000 })
      .toMatch(/перемещена в корзину/);
    // Восстановление из корзины снято отдельной проверкой ниже (MR-10): в 0.9.38
    // до неё было не дойти — переход в корзину не кликался под ещё живым листом
    // действий.
    await shot(page, 'mb11-trash-toast-360');
  });

  // MR-10: корзина на телефоне — компактный ряд, действия в листе строки.
  test('корзина: компактный ряд и восстановление из его листа', async ({ page }) => {
    await zenOff(page);
    await signInMobile(page, 'mb11-mr10-restore');
    const title = 'Заметка для корзины MR-10';
    await saveNote(page, 'Текст заметки, которую вернули из корзины.', title);

    await page.getByRole('button', { name: 'Заметки' }).click();
    const row = page.getByText(title).first();
    await expect(row, 'заметка не появилась в архиве').toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /Действия с заметкой/ }).first().click();
    const sheet = page.getByRole('dialog').first();
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    await sheet.getByRole('button', { name: /^Удалить заметку$/ }).click();
    const confirm = page.getByRole('dialog').filter({ hasText: /Удалить эту заметку/ }).first();
    await expect(confirm, 'подтверждение удаления не появилось').toBeVisible({ timeout: 10_000 });
    const confirmButtons = (await confirm.locator('button').allInnerTexts()).map(x => x.trim()).filter(Boolean);
    await confirm.getByRole('button', { name: confirmButtons[confirmButtons.length - 1] ?? /Удалить/ }).click();
    await expect
      .poll(async () => (await toasts(page)).join(' | '), { timeout: 15_000 })
      .toMatch(/перемещена в корзину/);

    // Корзина открылась из листа «⋯» шапки (MR-8), а не кнопкой в шапке.
    await page.getByRole('button', { name: 'Ещё' }).click();
    const menu = page.getByRole('dialog').last();
    await expect(menu, 'лист «⋯» не открылся').toBeVisible({ timeout: 15_000 });
    await menu.getByRole('button', { name: /Корзина/ }).click();
    await expect(page.getByRole('heading', { name: 'Корзина', exact: true })).toBeVisible({ timeout: 15_000 });

    const trashRow = page.getByText(title).first();
    await expect(trashRow, 'удалённая заметка не видна в корзине').toBeVisible({ timeout: 20_000 });
    // Компактный ряд: 64 px вместо карточки в 190 px (0.9.38).
    const rowBox = page.locator('div[class*="h-16"]').filter({ hasText: title }).first();
    const box = await rowBox.boundingBox();
    expect(box, 'у компактного ряда корзины нет геометрии').not.toBeNull();
    expect(box!.height, `ряд корзины выше 72 px: ${Math.round(box!.height)}`).toBeLessThanOrEqual(72.5);
    // Двух кнопок в ряд больше не клали: восстановление — в листе строки.
    await expect(page.getByRole('button', { name: /^Восстановить$/ }), 'кнопка восстановления снова в ряду')
      .toHaveCount(0);
    await page.getByRole('button', { name: /Действия с заметкой/ }).first().click();
    const rowMenu = page.getByRole('dialog').filter({ hasText: 'Восстановить' }).first();
    await expect(rowMenu, 'в листе строки нет восстановления').toBeVisible({ timeout: 15_000 });
    await shot(page, 'mr10-trash-row-menu-360');
    await rowMenu.getByRole('button', { name: /^Восстановить$/ }).click();

    await expect(page.getByRole('heading', { name: 'Корзина пуста' }), 'корзина не опустела')
      .toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Ещё' }).click();
    await page.getByRole('dialog').last().getByRole('button', { name: /К заметкам/ }).click();
    await expect(page.getByText(title).first(), 'заметка не вернулась в список').toBeVisible({ timeout: 20_000 });
    await shot(page, 'mr10-restored-360');
  });
});
