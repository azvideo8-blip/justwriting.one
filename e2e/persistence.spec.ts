import { test, expect } from '@playwright/test';

// AUDIT-M18: ключевой путь дневника — «написал → перезагрузил → заметка на
// месте» — не был покрыт e2e. Тексты строго синтетические.
//
// Замечания по поведению приложения (проверено прогоном):
// - autosave дергается вводом с клавиатуры; editor.fill() не запускает
//   debounce-цепочку — печатаем pressSequentially.
// - Черновик восстанавливается в редактор после reload (IndexedDB LocalDraft).
// - В архив попадает только ЗАВЕРШЁННАЯ сессия: Finish → mood-модалка → Finish.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('app_language', 'en');
    localStorage.setItem('jw_guest_id', 'guest_e2e-fixed');
  });
});

const NOTE_TEXT = 'E2E persistence check: the quick synthetic fox jumps over the lazy fence.';

async function typeNote(page: import('@playwright/test').Page, text: string): Promise<void> {
  await page.goto('/');
  const editor = page.locator('textarea').first();
  await expect(editor).toBeVisible({ timeout: 15000 });
  await editor.click();
  await editor.pressSequentially(text, { delay: 10 });
}

/** Завершает сессию и сохраняет заметку.
 *  Флоу (с DC-W3 — один шаг, настроение внутри): Cmd/Ctrl+Enter → окно итогов → Save.
 *  Заголовок итогов меняется от сессии к сессии («Written N words…»), поэтому
 *  опора — окно и его кнопка, а не текст заголовка. */
async function finishAndSave(page: import('@playwright/test').Page): Promise<void> {
  // Кнопка Stop на десктопе перекрыта контейнером редактора —
  // используем системный шорткат завершения сессии.
  await page.keyboard.press('ControlOrMeta+Enter');
  const dialog = page.locator('[role="dialog"]');
  // «Save» в тулбаре тоже так называется — берём кнопку из модалки.
  const save = dialog.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeVisible({ timeout: 10000 });
  await save.click();
  // Ждать закрытия модалки = успешное сохранение (иначе остаётся с ошибкой).
  await expect(dialog).toBeHidden({ timeout: 20000 });
  await page.waitForTimeout(2000);
}

test.describe('Persistence (AUDIT-M18)', () => {
  test('note survives a full page reload', async ({ page }) => {
    await typeNote(page, NOTE_TEXT);

    // Дождаться автосейва: дебаунс 500 мс + запись в IndexedDB.
    await page.waitForTimeout(3000);

    await page.reload();
    const editorAfter = page.locator('textarea').first();
    await expect(editorAfter).toBeVisible({ timeout: 15000 });
    // Черновик восстанавливается в поле асинхронно — ждём появления текста.
    await expect(editorAfter).toHaveValue(NOTE_TEXT, { timeout: 15000 });
  });

  test('finished note is visible in archive', async ({ page }) => {
    await typeNote(page, 'Archive listing check: synthetic guest note for e2e.');
    await page.waitForTimeout(1500);
    await finishAndSave(page);

    await page.goto('/archive');
    await expect(page.getByText('Archive listing check').first()).toBeVisible({
      timeout: 15000,
    });
  });

  // AUDIT-M18: guest→signup миграция через e2e неприменима — регистрация
  // в продукте осознанно закрыта (SIGNUP_ENABLED=false, DISABLE_SIGNUP на
  // сервере). Сама миграция гостевого черновика покрыта юнит-тестом
  // migrateDraftConsumed.test.ts.
});
