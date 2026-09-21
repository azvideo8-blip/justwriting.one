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
    // AG-ONBOARD-1 shows a goal-picker before a genuinely new account's first
    // session (see WritingPage.tsx). These tests are about persistence, not
    // onboarding, so pin the guest id and mark it already done — same state
    // as any real user past their first visit.
    localStorage.setItem('jw_guest_id', 'guest_e2e-fixed');
    localStorage.setItem('onboarding_done_guest_e2e-fixed', '1');
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
 *  Флоу: Cmd/Ctrl+Enter → «Session complete.» → Save → mood-шаг → Finish. */
async function finishAndSave(page: import('@playwright/test').Page): Promise<void> {
  // Кнопка Stop на десктопе перекрыта контейнером редактора —
  // используем системный шорткат завершения сессии.
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByText('Session complete.')).toBeVisible({ timeout: 10000 });
  // «Save» в тулбаре тоже так называется — берём кнопку из модалки.
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  // Ждать закрытия модалки = успешное сохранение (иначе остаётся с ошибкой).
  await expect(page.getByText('Session complete.')).toBeHidden({ timeout: 20000 });
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
