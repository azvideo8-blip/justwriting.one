// MQ-10: фон нижней панели вкладок непрозрачен (альфа ≥ 0,95) во всех темах.
import { expect, test } from '@playwright/test';
import { shot, signInMobile, zenOff } from './harness';

test.use({ viewport: { width: 390, height: 844 } });

const THEMES = ['amethyst', 'modern', 'notion', 'spotify'] as const;

test('MQ-10: нижняя панель непрозрачна в четырёх темах', async ({ page }) => {
  await zenOff(page);
  await signInMobile(page, 'mq10-nav');
  for (const theme of THEMES) {
    await page.evaluate((t) => localStorage.setItem('app-theme', JSON.stringify(t)), theme);
    await page.goto('/me');
    const nav = page.getByTestId('mobile-bottom-nav');
    await expect(nav).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400);
    const bg = await nav.evaluate(el => getComputedStyle(el).backgroundColor);
    const alpha = /rgba?\(([^)]+)\)/.exec(bg)?.[1]?.split(',').map(s => s.trim())[3];
    expect.soft(alpha === undefined || Number(alpha) >= 0.95, `${theme}: фон панели ${bg}`).toBe(true);
    await shot(page, `mq10-nav-${theme}`);
  }
});
