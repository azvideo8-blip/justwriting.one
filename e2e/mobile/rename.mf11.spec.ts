// MF-11: «Изменить название» на телефоне ничего не делало — ни из «⋯» списка, ни
// из читалки. Закрытие листа действий снимало свою запись истории
// (history.back), а асинхронный popstate закрывал только что открытый лист
// переименования; в списке поле теряло фокус и закрывалось без изменений.
// Проверка: новое название в списке ПОСЛЕ перезагрузки.
import { expect, test, type Page } from '@playwright/test';
import { openVaultFromBanner, shot, signInMobile, zenOff, type Account } from './harness';

test.use({ viewport: { width: 390, height: 844 } });

async function saveNote(page: Page, text: string): Promise<void> {
  await page.goto('/');
  const editor = page.locator('textarea').first();
  await editor.waitFor({ state: 'visible', timeout: 30_000 });
  await editor.fill(text);
  await page.locator('[data-write-toolbar]').getByRole('button', { name: /^Сохранить$/ }).click();
  const finish = page.locator('[aria-labelledby="finish-modal-title"]');
  await expect(finish).toBeVisible({ timeout: 15_000 });
  await finish.getByRole('button', { name: /^Сохранить$/ }).click();
  await expect(finish, 'окно завершения не закрылось — сохранение не дошло').toBeHidden({ timeout: 20_000 });
}

async function toArchive(page: Page, account: Account): Promise<void> {
  await page.goto('/archive');
  await openVaultFromBanner(page, account.password);
}

/** Лист переименования: поле, «Сохранить». Возвращает false, если листа нет. */
async function renameInSheet(page: Page, title: string): Promise<boolean> {
  const sheet = page.getByRole('dialog', { name: /Изменить название/ });
  if (!(await sheet.waitFor({ state: 'visible', timeout: 4_000 }).then(() => true, () => false))) return false;
  await page.waitForTimeout(600);
  if (!(await sheet.isVisible())) return false;
  await sheet.getByRole('textbox').fill(title);
  await sheet.getByRole('button', { name: /^Сохранить$/ }).click();
  await expect(sheet).toBeHidden({ timeout: 5_000 });
  return true;
}

async function expectTitleAfterReload(page: Page, account: Account, title: string): Promise<void> {
  await page.waitForTimeout(1_500);
  await page.reload();
  await toArchive(page, account);
  await expect(page.getByText(title).first(), `после перезагрузки нет «${title}»`).toBeVisible({ timeout: 20_000 });
}

test('MF-11: переименование из списка, из читалки и из сетки переживает перезагрузку', async ({ page }) => {
  await zenOff(page);
  const account = await signInMobile(page, 'mf11-rename');
  await saveNote(page, 'Перваязаметка про глину и круг. Второе предложение.');

  // 1) Список: «⋯» → «Изменить название».
  await toArchive(page, account);
  await page.getByRole('button', { name: 'Действия с заметкой' }).first().click();
  await page.getByRole('button', { name: /^Изменить название$/ }).click();
  const listOk = await renameInSheet(page, 'Имя из списка');
  await shot(page, 'mf11-after-list-rename');
  expect.soft(listOk, 'из списка лист переименования не открылся или закрылся сам').toBe(true);
  const listTitle = listOk ? 'Имя из списка' : 'Перваязаметка';
  if (listOk) await expectTitleAfterReload(page, account, 'Имя из списка');

  // 2) Читалка: тап по строке → «⋯» → «Изменить название» (MF-12 — карандаш у названия).
  await page.keyboard.press('Escape').catch(() => {});
  await toArchive(page, account);
  await page.getByText(listTitle).first().click();
  const reader = page.getByRole('dialog').filter({ hasText: listTitle }).first();
  await expect(reader).toBeVisible({ timeout: 15_000 });
  const pencil = reader.getByRole('button', { name: /^Изменить название$/ });
  if (await pencil.count()) {
    await pencil.first().click();
  } else {
    await reader.getByRole('button', { name: /Действия с заметкой|Ещё/ }).first().click();
    await page.getByRole('button', { name: /^Изменить название$/ }).click();
  }
  const readerOk = await renameInSheet(page, 'Имя из читалки');
  expect.soft(readerOk, 'из читалки лист переименования не открылся или закрылся сам').toBe(true);
  await page.keyboard.press('Escape').catch(() => {});
  if (readerOk) await expectTitleAfterReload(page, account, 'Имя из читалки');
  else await toArchive(page, account);

  // 3) Сетка: «⋯» → «Сетка», затем «⋯» карточки → «Изменить название».
  await page.getByRole('button', { name: 'Ещё' }).click();
  await page.getByRole('button', { name: /^Сетка$/ }).click();
  await page.getByRole('button', { name: 'Закрыть' }).first().click();
  // MP-2: у карточки сетки лист действий открывает только долгое нажатие.
  const card = page.getByText(/Имя из|Перваязаметка/).first();
  await card.dispatchEvent('touchstart');
  await page.waitForTimeout(700);
  await card.dispatchEvent('touchend');
  await page.getByRole('button', { name: /^Изменить название$/ }).click();
  const gridOk = await renameInSheet(page, 'Имя из сетки');
  expect.soft(gridOk, 'из сетки лист переименования не открылся или закрылся сам').toBe(true);
  if (gridOk) await expectTitleAfterReload(page, account, 'Имя из сетки');
});
