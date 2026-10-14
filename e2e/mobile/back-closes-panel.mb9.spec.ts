// MB-9 (F-29): «назад» закрывает открытую панель, а не уводит из приложения.
// На телефоне в PWA это единственный путь назад; аппаратная «назад» Android и
// свайп iOS ведут себя так же.
import { expect, test, type Page } from '@playwright/test';
import { shot, signInMobile, waitForQuietDialogs, zenOff } from './harness';

test.use({ viewport: { width: 360, height: 640 } });

/** Сохраняет заметку, чтобы в архиве было с чем работать. */
async function saveOneNote(page: Page, text: string): Promise<void> {
  // MR-6 (направление A): редактор открыт сразу, «Начать» и лист режима больше
  // не нужны, чтобы просто написать заметку.
  await page.goto('/');
  const editor = page.locator('textarea').first();
  await editor.waitFor({ state: 'visible', timeout: 30_000 });
  await editor.fill(text);
  await page.getByRole('button', { name: /^Готово$/ }).click();
  const finish = page.getByRole('dialog').first();
  await expect(finish).toBeVisible({ timeout: 15_000 });
  await finish.getByRole('button', { name: /^Сохранить$/ }).click();
  await page.waitForTimeout(1_500);
}

test.describe('MB-9: назад закрывает панель', () => {
  test('«Я → Настройки»: «назад» возвращает на /me, а не уходит из приложения', async ({ page }) => {
    await zenOff(page);
    await signInMobile(page, 'mb9-settings');

    await page.goto('/me');
    // На WebKit окно первого запуска может приехать уже после перехода на «Я» и
    // перехватить клик по шестерёнке (в полном прогоне 12.10 это и уронило тест).
    await waitForQuietDialogs(page, 20_000);
    const settings = page.getByRole('button', { name: /^Настройки$/ }).first();
    await expect(settings, 'кнопки «Настройки» на «Я» нет').toBeVisible({ timeout: 20_000 });
    await settings.click();

    // MR-5: шестерёнка «Профиля» ведёт в настройки приложения — это переход, а
    // не панель, так что «назад» должен вернуть на /me.
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe('/settings');
    await shot(page, 'mb9-settings-open-360');

    await page.goBack();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe('/me');
    await shot(page, 'mb9-settings-after-back-360');
  });

  test('лист действий: закрыл кнопкой, потом «назад» — уходит со страницы, лист не воскресает', async ({ page }) => {
    await zenOff(page);
    await signInMobile(page, 'mb9-sheet');

    await saveOneNote(page, 'Заметка для проверки назад. Раз два три.');
    await page.getByRole('button', { name: 'Заметки' }).click();

    const actions = page.getByRole('button', { name: /Действия с заметкой/ }).first();
    await expect(actions, 'листа действий не видно').toBeVisible({ timeout: 20_000 });
    await actions.click();

    const sheet = page.getByRole('dialog').first();
    await expect(sheet, 'лист действий не открылся').toBeVisible({ timeout: 15_000 });

    await sheet.getByRole('button', { name: /^Закрыть$/ }).click();
    await expect(sheet).toBeHidden({ timeout: 10_000 });

    // Запись листа снята закрытием — значит «назад» обязан увести со страницы,
    // а не открыть лист-призрак.
    await page.goBack();
    // WebKit дописывает навигацию «назад» заметно дольше фиксированных 1,5 с:
    // ждём через poll, иначе тест падает на ещё не завершившемся переходе.
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 10_000 })
      .not.toBe('/archive');
    await expect(page.getByRole('dialog'), 'лист открылся сам («призрак»)').toHaveCount(0);
    await shot(page, 'mb9-after-close-then-back');
  });

  test('лист действий: «назад» закрывает сам лист, страница остаётся', async ({ page }) => {
    await zenOff(page);
    await signInMobile(page, 'mb9-sheet-back');

    await saveOneNote(page, 'Вторая заметка для проверки назад.');
    await page.getByRole('button', { name: 'Заметки' }).click();
    const actions = page.getByRole('button', { name: /Действия с заметкой/ }).first();
    await expect(actions).toBeVisible({ timeout: 20_000 });
    await actions.click();
    await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 15_000 });

    await page.goBack();
    await expect(page.getByRole('dialog'), '«назад» не закрыл лист').toHaveCount(0, { timeout: 15_000 });
    expect(new URL(page.url()).pathname, '«назад» увёл с /archive').toBe('/archive');
  });
});
