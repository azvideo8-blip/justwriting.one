// MR-9: строка заметки на телефоне — тап открывает, долгое нажатие ведёт в лист
// действий, кнопок правки тегов в списке нет.
//
// Здесь же проверка находки ревьюера: спек MB-11 (`note-row-tap-and-trash.mb11.spec.ts`)
// считал предпросмотр открытым по классу `.glass-panel`, а этот класс живёт в
// DOM и до всякого тапа — проверка была пустой. Спек печатает счётчик панелей
// до тапа, чтобы это было видно в выводе прогона.
import { expect, test, type Page } from '@playwright/test';
import { openVaultFromBanner, shot, signInMobile, zenOff } from './harness';

const SIZES = [{ w: 360, h: 640 }, { w: 390, h: 844 }];

async function saveNote(page: Page, text: string, title: string): Promise<void> {
  await page.goto('/');
  const editor = page.locator('textarea').first();
  await editor.waitFor({ state: 'visible', timeout: 30_000 });
  await editor.fill(text);
  await page.locator('[data-write-toolbar]').getByRole('button', { name: /^Сохранить$/ }).click();
  const finish = page.getByRole('dialog').first();
  await expect(finish).toBeVisible({ timeout: 15_000 });
  const titleInput = finish.getByLabel(/Название/).first();
  if (await titleInput.isVisible().catch(() => false)) await titleInput.fill(title);
  await finish.getByRole('button', { name: /^Сохранить$/ }).click();
  await page.waitForTimeout(800);
}

for (const { w, h } of SIZES) {
  test.describe(`MR-9: ряд заметки на ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('тап по заголовку открывает заметку, лист действий — по долгому нажатию', async ({ page }) => {
      await zenOff(page);
      const account = await signInMobile(page, `mr9-${w}`);
      const title = `Запись про тап ${w}`;
      await saveNote(page, 'Текст про глину и глазурь. Раз два три.', title);

      await page.goto('/archive');
      await openVaultFromBanner(page, account.password);

      const row = page.getByText(title).first();
      await expect(row, 'заметка не появилась в архиве').toBeVisible({ timeout: 20_000 });

      // Улики по MB-11: сколько `.glass-panel` в DOM до всякого тапа.
      const panelsBefore = await page.locator('.glass-panel').count();
      const dialogsBefore = await page.getByRole('dialog').count();
      console.warn(`[mr9 ${w}] до тапа: .glass-panel=${panelsBefore}, role=dialog=${dialogsBefore}`);

      await row.click();
      const preview = page.getByRole('dialog').last();
      await expect(preview, 'тап по заголовку не открыл заметку').toBeVisible({ timeout: 15_000 });
      await expect(preview, 'открылась не заметка').toContainText('Текст про глину');
      await shot(page, `mr9-tap-opens-${w}`);

      // Долгое нажатие — отдельный вход: перезаходим, чтобы предпросмотр не мешал.
      await page.goto('/archive');
      await openVaultFromBanner(page, account.password);
      const row2 = page.getByText(title).first();
      await expect(row2).toBeVisible({ timeout: 20_000 });
      await row2.dispatchEvent('touchstart');
      await page.waitForTimeout(650);
      await row2.dispatchEvent('touchend');

      const actions = page.getByRole('dialog').filter({ hasText: 'Действия с заметкой' }).first();
      await expect(actions, 'долгое нажатие не открыло лист действий').toBeVisible({ timeout: 15_000 });
      await shot(page, `mr9-longpress-sheet-${w}`);

      // Правка тегов в списке не живёт: ни «Удалить тег», ни «Добавить тег».
      await actions.getByRole('button', { name: /^Закрыть$/ }).click();
      await expect(actions).toBeHidden({ timeout: 10_000 });
      await expect(page.getByRole('button', { name: /Добавить тег|Удалить тег/ }), 'в списке остались кнопки тегов')
        .toHaveCount(0);
    });

    test('«⋯» ряда — цель 44 px, и её тап не открывает заметку', async ({ page }) => {
      await zenOff(page);
      const account = await signInMobile(page, `mr9-targets-${w}`);
      await saveNote(page, 'Заметка для проверки кнопки.', `Запись для кнопки ${w}`);

      await page.goto('/archive');
      await openVaultFromBanner(page, account.password);

      const more = page.getByRole('button', { name: 'Действия с заметкой' }).first();
      await expect(more).toBeVisible({ timeout: 20_000 });
      const box = await more.boundingBox();
      expect(box, 'у «⋯» нет геометрии').not.toBeNull();
      expect(box!.width, `«⋯» шире/уже 44 px: ${Math.round(box!.width)}`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `«⋯» ниже 44 px: ${Math.round(box!.height)}`).toBeGreaterThanOrEqual(44);

      const dialogsBefore = await page.getByRole('dialog').count();
      await more.click();
      const actions = page.getByRole('dialog').filter({ hasText: 'Действия с заметкой' }).first();
      await expect(actions, '«⋯» не открыла лист действий').toBeVisible({ timeout: 15_000 });
      // Открылся именно лист, а не предпросмотр: у предпросмотра aria-label —
      // заголовок заметки.
      await expect(page.getByRole('dialog', { name: `Запись для кнопки ${w}` }), 'тап по «⋯» открыл заметку')
        .toHaveCount(0);
      expect(await page.getByRole('dialog').count(), 'диалогов стало не один')
        .toBe(dialogsBefore + 1);
    });
  });
}
