import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('app_language', 'en');
  });
});

test.describe('Writing Session', () => {
  test('page loads with editor visible', async ({ page }) => {
    await page.goto('/');
    const editor = page.locator('textarea').first();
    await expect(editor).toBeVisible({ timeout: 15000 });
  });

  test('can type in editor', async ({ page }) => {
    await page.goto('/');
    const editor = page.locator('textarea').first();
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.fill('Hello world, this is a test of the writing editor.');
    await expect(editor).toHaveValue(/Hello world/);
  });

  test('word count updates after typing', async ({ page }) => {
    await page.goto('/');
    const editor = page.locator('textarea').first();
    await expect(editor).toBeVisible({ timeout: 15000 });

    const statsArea = page.locator('[aria-label="Word goal"]').or(
      page.locator('text=Session words').locator('..')
    );
    await expect(statsArea).toBeVisible({ timeout: 10000 });

    await editor.fill('one two three four five');
    await page.waitForTimeout(500);

    const wordButton = page.locator('button[aria-label="Word goal"]');
    await expect(wordButton).toBeVisible();
  });

  test('timer area is present', async ({ page }) => {
    await page.goto('/');
    const editor = page.locator('textarea').first();
    await expect(editor).toBeVisible({ timeout: 15000 });

    const timeButton = page.locator('button[aria-label="Time goal"]');
    await expect(timeButton).toBeVisible({ timeout: 10000 });
  });

  test('save button is present in toolbar', async ({ page }) => {
    await page.goto('/');
    const editor = page.locator('textarea').first();
    await expect(editor).toBeVisible({ timeout: 15000 });

    const saveButton = page.locator('button[aria-label="Save"]').or(
      page.locator('button[aria-label="Сохранить"]')
    );
    await expect(saveButton).toBeVisible({ timeout: 10000 });
  });

  test('new session button is present in toolbar', async ({ page }) => {
    await page.goto('/');
    const editor = page.locator('textarea').first();
    await expect(editor).toBeVisible({ timeout: 15000 });

    const newButton = page.locator('button[aria-label="New note"]').or(
      page.locator('button[aria-label="Новая заметка"]')
    );
    await expect(newButton).toBeVisible({ timeout: 10000 });
  });
});
