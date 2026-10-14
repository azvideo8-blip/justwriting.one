// MP-2: сетка на телефоне — только текст. Даты, относительного времени, счётчиков,
// чипсов тегов и ряда иконок в карточке нет; тап открывает читалку, долгое
// нажатие ведёт в лист действий и заметку не открывает.
import { expect, test, type Page } from '@playwright/test';
import { openVaultFromBanner, shot, signInMobile, zenOff, type Account } from './harness';

async function saveNote(page: Page, text: string, title: string): Promise<void> {
  await page.goto('/');
  const editor = page.locator('textarea').first();
  await editor.waitFor({ state: 'visible', timeout: 30_000 });
  await editor.fill(text);
  await page.getByRole('button', { name: /^Готово$/ }).click();
  const finish = page.getByRole('dialog').last();
  await expect(finish).toBeVisible({ timeout: 15_000 });
  const titleInput = finish.getByLabel(/Название/).first();
  if (await titleInput.isVisible().catch(() => false)) await titleInput.fill(title);
  await finish.getByRole('button', { name: /^Сохранить$/ }).click();
  await expect(page.locator('[aria-labelledby="finish-modal-title"]'), 'окно завершения не закрылось — сохранение не дошло')
    .toBeHidden({ timeout: 20_000 });
}

async function toGridView(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Ещё' }).click();
  const sheet = page.getByRole('dialog').filter({ hasText: 'Вид' }).first();
  await expect(sheet, 'лист «Ещё» не открылся').toBeVisible({ timeout: 15_000 });
  // Смену вида лист не закрывает (MR-8): закрывает его кнопка «✕» самого листа.
  await sheet.getByRole('button', { name: 'Сетка' }).click();
  await sheet.getByRole('button', { name: 'Закрыть' }).click();
  await expect(sheet, 'лист «Ещё» не закрылся — сетка под ним').toBeHidden({ timeout: 10_000 });
  await expect(page.locator('.archive-grid-two-col').first(), 'сетка не появилась').toBeVisible({ timeout: 15_000 });
}

async function toArchive(page: Page, account: Account): Promise<void> {
  await page.goto('/archive');
  await openVaultFromBanner(page, account.password);
}

for (const { w, h } of [{ w: 390, h: 844 }, { w: 360, h: 640 }]) {
  test.describe(`MP-2: сетка на ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('в карточках только текст, тап открывает читалку', async ({ page }) => {
      await zenOff(page);
      const account = await signInMobile(page, `mp2-grid-${w}`);
      await saveNote(page, 'Глина сохнет быстрее, чем кажется. Поэтому круг крутят медленно.', `Круг ${w}`);
      await saveNote(page, 'Обжиг занимает вечер, глазурь ложится ровно не с первого раза.', `Обжиг ${w}`);

      await toArchive(page, account);
      await shot(page, `mp2-before-list-${w}`);
      await toGridView(page);

      const grid = page.locator('.archive-grid-two-col').first();
      await expect(grid.getByText(`Круг ${w}`), 'в карточке нет заголовка').toBeVisible();
      await expect(grid.getByText(/Глина сохнет/), 'в карточке нет текста').toBeVisible();
      await expect(grid.getByText(/назад/), 'в карточке осталось относительное время').toHaveCount(0);
      await expect(grid.getByText(/слов/), 'в карточке остались счётчики').toHaveCount(0);
      await expect(grid.getByRole('button'), 'в карточке остался ряд иконок').toHaveCount(0);
      await shot(page, `mp2-grid-${w}`);

      // Карточки одной строки — одинаковой высоты.
      const heights = await grid.evaluate((list) => {
        const cards = Array.from(list.children).map(el => Math.round(el.getBoundingClientRect().height));
        return cards;
      });
      expect(heights.length, 'карточек меньше двух').toBeGreaterThanOrEqual(2);
      const firstRow = heights.slice(0, 2);
      expect(Math.max(...firstRow) - Math.min(...firstRow), `высоты строк различаются: ${firstRow.join(' vs ')}`).toBeLessThanOrEqual(2);

      await grid.getByText(`Круг ${w}`).click();
      const reader = page.getByRole('dialog', { name: `Круг ${w}` }).first();
      await expect(reader, 'тап по карточке не открыл читалку').toBeVisible({ timeout: 15_000 });
      await expect(reader.getByText(/Глина сохнет/)).toBeVisible();
    });

    test('долгое нажатие открывает лист действий и не открывает заметку', async ({ page }) => {
      await zenOff(page);
      const account = await signInMobile(page, `mp2-press-${w}`);
      await saveNote(page, 'Заметка про долгое нажатие в сетке.', `Нажатие ${w}`);

      await toArchive(page, account);
      await toGridView(page);
      const card = page.getByText(`Нажатие ${w}`).first();
      await expect(card).toBeVisible({ timeout: 20_000 });
      await card.dispatchEvent('touchstart');
      await page.waitForTimeout(650);
      await card.dispatchEvent('touchend');

      const sheet = page.getByRole('dialog', { name: 'Действия с заметкой' });
      await expect(sheet, 'долгое нажатие не открыло лист действий').toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('dialog', { name: `Нажатие ${w}` }), 'долгое нажатие ещё и открыло заметку')
        .toHaveCount(0);
      await shot(page, `mp2-grid-sheet-${w}`);
    });
  });
}
