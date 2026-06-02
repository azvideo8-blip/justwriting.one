import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test('loads successfully', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/justwriting/i);
  });

  test('has interactive elements', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('button').first()).toBeVisible();
  });
});
