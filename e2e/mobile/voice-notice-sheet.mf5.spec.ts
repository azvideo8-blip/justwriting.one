// MF-5: первый тап по микрофону на телефоне — один лист «Голосовой ввод» (куда
// уходит голос, сколько стоит, «Больше не показывать»); «Записать» начинает
// запись сразу, с галочкой следующий тап пишет без листа.
import { expect, test } from '@playwright/test';
import { DICTATION_ENGINE, shot, signInMobile, speechCounters, zenOff } from './harness';

test.use({ viewport: { width: 390, height: 844 } });

test('MF-5: лист перед записью, «Записать» стартует, галочка убирает лист', async ({ page }) => {
  await page.addInitScript(DICTATION_ENGINE);
  await zenOff(page);
  await signInMobile(page, 'mf5-notice');
  await page.goto('/');
  await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 30_000 });

  const mic = page.locator('[data-write-toolbar]').getByRole('button', { name: /диктовк/i });
  await mic.click();
  const sheet = page.getByRole('dialog').filter({ hasText: /Голосовой ввод/ });
  await expect(sheet).toBeVisible({ timeout: 5_000 });
  await expect(sheet).toContainText(/службу распознавания речи браузера/);
  await shot(page, 'mf5-voice-sheet-390');
  const box = sheet.getByRole('checkbox', { name: /Больше не показывать/ });
  const vault = !(await box.count());
  if (!vault) await box.check();
  await sheet.getByRole('button', { name: /^Записать$/ }).click();
  await expect(page.locator('[data-dictation-row]'), 'запись не началась').toBeVisible({ timeout: 5_000 });
  expect((await speechCounters(page)).starts).toBe(1);
  await page.getByRole('button', { name: /^Отменить$/ }).click();
  await expect(page.locator('[data-dictation-row]')).toHaveCount(0, { timeout: 5_000 });

  await mic.click();
  if (vault) {
    // Сейф: предупреждение каждый раз, без галочки.
    await expect(sheet).toBeVisible({ timeout: 5_000 });
    await expect(sheet.getByRole('checkbox')).toHaveCount(0);
  } else {
    await expect(page.locator('[data-dictation-row]'), 'после галочки лист всё ещё стоит').toBeVisible({ timeout: 5_000 });
    await expect(sheet).toHaveCount(0);
  }
});
