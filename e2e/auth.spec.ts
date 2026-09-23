import { test, expect } from '@playwright/test';

test.describe('Login Page', () => {
  test('loads login form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('shows error for invalid credentials', async ({ page }) => {
    // Needs a real auth round-trip (GoTrue behind VITE_SUPABASE_URL). CI starts
    // only the Vite dev server, so nothing answers. Runs locally, skipped in CI.
    test.skip(!!process.env.CI, 'real auth backend is not running in CI (see L-15)');
    await page.goto('/login');
    await page.fill('input[type="email"]', 'invalid@example.com');
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    // Assert an error is surfaced (role=alert), not a specific message: the
    // wording depends on what the auth server returns in that environment.
    await expect(page.locator('[role="alert"]')).toBeVisible();
  });

  test('does not overflow horizontally on mobile viewport (390x844) (S-14)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login');
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);
  });
});
