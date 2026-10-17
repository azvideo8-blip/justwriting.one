// MQ-13 (N-3): степпер первого входа у человека, который согласие уже давал.
// Шаг остаётся один — «Шаг 1 из 1» показывать не за чем, и счётчик в этом
// состоянии обязан исчезнуть. Раньше это было закрыто только vitest'ом, потому
// что такой вход на стенде не собирался: собирается, если до входа положить в
// localStorage отметку принятой версии (тот же путь, что приложение делает само
// после ответа на шаге политики).
import { expect, test } from '@playwright/test';
import { AI_CONSENT_VERSION_REQUIRED } from '../../src/core/constants/privacyVersion';
import { autoHandlers, createMobileAccount, shot, zenOff } from './harness';

test.use({ viewport: { width: 390, height: 844 } });

async function signInLeavingFirstRun(page: import('@playwright/test').Page, tag: string) {
  const account = await createMobileAccount(tag);
  await autoHandlers(page, account.password);
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.locator('input[type="password"]').press('Enter');
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 90_000 });
  return account;
}

test('MQ-13: возвращающийся пользователь — один шаг и без счётчика', async ({ page }) => {
  await zenOff(page);
  const account = await signInLeavingFirstRun(page, 'mq13-one-step');
  const stepper = page.getByTestId('first-run-stepper');
  await expect(stepper).toBeVisible({ timeout: 60_000 });
  // До правки шагов минимум два, и счётчик есть — иначе тест ничего не проверяет.
  await expect(page.getByTestId('first-run-step')).toBeVisible();

  await page.evaluate(([uid, version]) => {
    localStorage.setItem(`privacy_accepted_${uid}`, String(version));
  }, [account.uid, AI_CONSENT_VERSION_REQUIRED] as const);
  await page.reload();

  await expect(stepper).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('first-run-step'), 'счётчик «Шаг 1 из 1» показан').toHaveCount(0);
  // Остался ровно один шаг: у него есть активная кнопка продолжения и нет
  // подписи «Шаг … из …» (проверено выше).
  const next = stepper.locator('footer button').first();
  await expect(next).toBeVisible();
  await expect(next).toBeEnabled();
  await shot(page, 'mq13-one-step-390');
});
