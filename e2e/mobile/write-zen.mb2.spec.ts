// MB-2 (F-1): дзен на телефоне не прячет «Стоп», микрофон, паузу и нижнюю панель.
// Сценарий — тот же A1 из аудита Fable: начать свободный поток, набрать текст,
// подождать; проверить, что кнопка завершения сессии на месте и целиком в экране.
// Десктопный дзен проверяет vitest (BottomNavStaysInZenMb2).
import { expect, test } from '@playwright/test';
import { fullyInViewport, pickFreeFlow, shot, signInMobile } from './harness';

test.use({ viewport: { width: 360, height: 640 } });

const TWENTY_WORDS = Array.from({ length: 20 }, (_, i) => `слово${i + 1}`).join(' ');

test('MB-2: после начала письма «Стоп» видна и целиком в экране, вкладки остаются', async ({ page }) => {
  await signInMobile(page, 'mb2-zen');

  await page.getByRole('button', { name: /^Начать$/ }).click();
  expect(await pickFreeFlow(page), 'лист «Выбери режим» не открылся').toBe(true);

  const editor = page.locator('textarea').first();
  await editor.waitFor({ state: 'visible', timeout: 30_000 });
  await editor.click();
  await editor.pressSequentially(TWENTY_WORDS, { delay: 8 });

  // Дзен включается через 300 мс после старта и прячет панели на любой keydown —
  // экранная клавиатура даёт их постоянно.
  await page.waitForTimeout(1_200);

  const stop = page.getByRole('button', { name: /^Стоп$/ });
  await expect(stop, '«Стоп» пропала в дзене').toBeVisible({ timeout: 10_000 });
  expect(await fullyInViewport(stop), '«Стоп» частично за краем экрана').toBe(true);

  // Вкладки тоже остаются: без нижней панели с телефона не выйти из письма.
  await expect(page.getByRole('button', { name: 'Заметки' })).toBeVisible();

  await shot(page, 'mb2-zen-stop-360');
});
