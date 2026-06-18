import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('app_language', 'en');
  });
});

test.describe('AI Page (unauthenticated)', () => {
  test('shows sign-up-required message when not authenticated', async ({ page }) => {
    await page.goto('/ai');

    const requiredTitle = page.locator('text=Sign up required').or(
      page.locator('text=Требуется регистрация')
    );
    await expect(requiredTitle).toBeVisible({ timeout: 15000 });
  });

  test('shows sign-in button when not authenticated', async ({ page }) => {
    await page.goto('/ai');

    const signInButton = page.locator('button', { hasText: /Sign In|Войти/i }).first();
    await expect(signInButton).toBeVisible({ timeout: 15000 });
  });

  test('does not show AI chat interface when not authenticated', async ({ page }) => {
    await page.goto('/ai');

    const requiredTitle = page.locator('text=Sign up required').or(
      page.locator('text=Требуется регистрация')
    );
    await expect(requiredTitle).toBeVisible({ timeout: 15000 });

    const chatInput = page.locator('input[placeholder*="placeholder"]').or(
      page.locator('input[placeholder*="напиши"]')
    );
    await expect(chatInput).not.toBeVisible();
  });
});
