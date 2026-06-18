import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('app_language', 'en');
  });
});

test.describe('Archive Page', () => {
  test('navigates to archive and shows header', async ({ page }) => {
    await page.goto('/archive');
    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible({ timeout: 15000 });
  });

  test('search input is present and functional', async ({ page }) => {
    await page.goto('/archive');
    const search = page.locator('input[aria-label="Search notes..."]').or(
      page.locator('input[aria-label="Поиск по заметкам..."]')
    );
    await expect(search).toBeVisible({ timeout: 15000 });
    await search.fill('test query');
    await expect(search).toHaveValue('test query');
  });

  test('list view toggle is present', async ({ page }) => {
    await page.goto('/archive');
    const listButton = page.locator('button[aria-label="List"]').or(
      page.locator('button[aria-label="Список"]')
    );
    await expect(listButton).toBeVisible({ timeout: 15000 });
  });

  test('grid view toggle works', async ({ page }) => {
    await page.goto('/archive');

    const gridButton = page.locator('button[aria-label="Grid"]').or(
      page.locator('button[aria-label="Сетка"]')
    );
    await expect(gridButton).toBeVisible({ timeout: 15000 });
    await gridButton.click();

    const listButton = page.locator('button[aria-label="List"]').or(
      page.locator('button[aria-label="Список"]')
    );
    await expect(listButton).toBeVisible();
  });

  test('sort dropdown is present', async ({ page }) => {
    await page.goto('/archive');
    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible({ timeout: 15000 });

    const sortButton = page.locator('button[aria-expanded]').filter({
      hasText: /Newest first|Сначала новые/i,
    });
    await expect(sortButton).toBeVisible({ timeout: 10000 });
  });

  test('keyboard shortcut focuses search (Cmd+K)', async ({ page }) => {
    await page.goto('/archive');
    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible({ timeout: 15000 });

    await page.keyboard.press('Meta+k');

    const search = page.locator('input[aria-label="Search notes..."]').or(
      page.locator('input[aria-label="Поиск по заметкам..."]')
    );
    await expect(search).toBeFocused();
  });
});
