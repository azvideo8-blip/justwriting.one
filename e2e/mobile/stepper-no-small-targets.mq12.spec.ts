// MQ-12 (N-3): в мастере первого входа все цели касания — 44 px.
// Галочки согласия и «сохранил код» были полем 24 px: строка-подпись нажималась,
// но сам контрол оставался меньше нормы, и `smallTargets` в аудите показывал их
// на каждом шаге. Правка — CheckboxRow: квадрат остаётся 24 px, а зоной нажатия
// становится вся строка (прозрачный input растянут по строке).
import { expect, test } from '@playwright/test';
import { autoHandlers, createMobileAccount, shot, smallTargets, zenOff } from './harness';

test.use({ viewport: { width: 390, height: 844 } });

test('MQ-12: на всех шагах мастера нет целей меньше 44 px', async ({ page }) => {
  await zenOff(page);
  const account = await createMobileAccount('mq12-targets');
  await autoHandlers(page, account.password);
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.locator('input[type="password"]').press('Enter');
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 90_000 });

  const stepper = page.getByTestId('first-run-stepper');
  await expect(stepper).toBeVisible({ timeout: 60_000 });

  const seen: string[] = [];
  let steps = 0;
  for (let guard = 0; guard < 5; guard++) {
    if (!(await stepper.isVisible().catch(() => false))) break;
    steps++;
    const small = await smallTargets(page);
    expect(small, `шаг ${guard + 1}: мелкие цели ${JSON.stringify(small)}`).toEqual([]);
    small.forEach(t => seen.push(t.label));
    await shot(page, `mq12-targets-step${guard + 1}`);

    // Обязательную галочку на шаге включаем — без неё «Продолжить» не активна.
    const required = stepper.getByRole('checkbox', { name: /Обязательно|прочитал|required/i }).first();
    if (await required.count() && !(await required.isChecked())) await required.check();
    const next = stepper.getByRole('button', { name: /^(Продолжить|Готово|Начать писать)$/ }).first();
    if (!(await next.count())) break;
    if (await next.isDisabled().catch(() => true)) break;
    await next.click();
    await page.waitForTimeout(400);
    if (!(await stepper.isVisible().catch(() => false))) break;
  }
  expect(steps, 'мастер не показал ни одного шага').toBeGreaterThan(0);
  void account;
});
