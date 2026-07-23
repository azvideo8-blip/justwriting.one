import { test, expect } from '@playwright/test';

test.describe('Login Page', () => {
  test('loads login form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('shows error for invalid credentials', async ({ page }) => {
    // Needs a real Firebase Auth round-trip. Under App Check enforcement the
    // headless CI request has no valid App Check token, so the response is
    // non-deterministic and no error surfaces in time. Runs locally, skipped in CI.
    test.skip(!!process.env.CI, 'real Firebase auth is non-deterministic in CI under App Check');
    await page.goto('/login');
    await page.fill('input[type="email"]', 'invalid@example.com');
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    // Assert an error is surfaced (role=alert), not a specific message: the exact
    // Firebase error code varies by environment (App Check enforcement in CI can
    // change auth/invalid-credential into a generic error).
    await expect(page.locator('[role="alert"]')).toBeVisible();
  });
});
