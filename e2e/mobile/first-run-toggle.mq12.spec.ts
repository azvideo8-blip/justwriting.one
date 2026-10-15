// MQ-12: переключатель «Это моё устройство» в мастере — цель 44 px по высоте, подпись строки нажимается.
import { expect, test } from '@playwright/test';
import { autoHandlers, createMobileAccount, shot, smallTargets, zenOff } from './harness';

test.use({ viewport: { width: 390, height: 844 } });

test('MQ-12: шаг «Код» — переключатель 44 px, клик по подписи переключает', async ({ page }) => {
  await zenOff(page);
  const account = await createMobileAccount('mq12-toggle');
  await autoHandlers(page, account.password);
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.locator('input[type="password"]').press('Enter');
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 90_000 });

  const stepper = page.locator('[data-testid="first-run-stepper"]');
  await expect(stepper).toBeVisible({ timeout: 60_000 });
  // Как в харнессе: «^Обязательно», иначе /обязательно/i цепляет «Необязательно» (ИИ-согласие).
  await stepper.getByRole('checkbox', { name: /^Обязательно|прочитал|^Required|I have read/i }).first().check();
  await stepper.getByRole('button', { name: /^Продолжить$/ }).click();

  const sw = stepper.getByRole('switch');
  await expect(sw, 'шаг с кодом не открылся').toBeVisible({ timeout: 15_000 });
  const small = (await smallTargets(page)).filter(s => s.cls.includes('shrink-0') && s.w >= 40 && s.w <= 56);
  expect(small, `переключатель меньше 44 px по высоте: ${JSON.stringify(small)}`).toEqual([]);
  const box = (await sw.boundingBox())!;
  expect(box.height, 'зона переключателя ниже 44 px').toBeGreaterThanOrEqual(44);

  const before = await sw.getAttribute('aria-checked');
  await stepper.getByText(/Это моё устройство|my device|Запомнить/i).first().click();
  expect(await sw.getAttribute('aria-checked'), 'клик по подписи не переключил').not.toBe(before);
  // На 9 px выше и ниже дорожки по-прежнему попадаем в переключатель.
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('[role="switch"]') !== null, [box.x + box.width / 2, box.y + 2]);
  expect(hit, 'выше дорожки зона нажатия не переключатель').toBe(true);
  await shot(page, 'mq12-toggle-390');
});
