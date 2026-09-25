import { test, expect } from '@playwright/test';

test.describe('Login Page', () => {
  test('loads login form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  // «Неверный пароль → ошибка» и настоящий вход проверяются после каждой
  // выкатки на боевом сервере (scripts/post-deploy-login.ts, TB-17): здесь,
  // на dev-сервере без GoTrue, эта проверка могла только пропускаться.

  test('does not overflow horizontally on mobile viewport (390x844) (S-14)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login');
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);
  });
});
