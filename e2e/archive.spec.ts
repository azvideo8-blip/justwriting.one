import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('app_language', 'en');
  });
});

async function seedNotes(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    const request = indexedDB.open('justwriting-local', 21);
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['documents', 'versions'], 'readwrite');
        const docsStore = tx.objectStore('documents');
        const versStore = tx.objectStore('versions');

        docsStore.put({
          id: 'doc_alpha',
          guestId: 'guest',
          title: 'Apples harvest report',
          currentVersion: 1,
          totalWords: 10,
          totalDuration: 60,
          sessionsCount: 1,
          firstSessionAt: Date.now(),
          lastSessionAt: Date.now(),
          tags: ['orchard'],
        });

        versStore.put({
          id: 'ver_alpha',
          documentId: 'doc_alpha',
          guestId: 'guest',
          version: 1,
          content: 'Apples were harvested in great quantities today.',
          wordCount: 10,
          wordsAdded: 10,
          charsAdded: 50,
          duration: 60,
          wpm: 20,
        });

        docsStore.put({
          id: 'doc_beta',
          guestId: 'guest',
          title: 'Deep ocean exploration',
          currentVersion: 1,
          totalWords: 12,
          totalDuration: 70,
          sessionsCount: 1,
          firstSessionAt: Date.now(),
          lastSessionAt: Date.now(),
          tags: ['marine'],
        });

        versStore.put({
          id: 'ver_beta',
          documentId: 'doc_beta',
          guestId: 'guest',
          version: 1,
          content: 'Submarine voyage beneath the deep blue waves.',
          wordCount: 12,
          wordsAdded: 12,
          charsAdded: 60,
          duration: 70,
          wpm: 25,
        });

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  });
}

test.describe('Archive Page', () => {
  test('navigates to archive and shows header', async ({ page }) => {
    await page.goto('/archive');
    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible({ timeout: 15000 });
  });

  test('search input filters notes list', async ({ page }) => {
    await page.goto('/archive');
    await seedNotes(page);
    await page.reload();

    // Verify both seeded notes appear initially
    await expect(page.getByText('Apples harvest report').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Deep ocean exploration').first()).toBeVisible({ timeout: 15000 });

    const search = page.locator('input[aria-label="Search notes..."]').or(
      page.locator('input[aria-label="Поиск по заметкам..."]')
    );
    await expect(search).toBeVisible({ timeout: 15000 });

    // Filter by "Apples"
    await search.fill('Apples');
    await expect(search).toHaveValue('Apples');

    // Matching note should be visible, non-matching should be excluded
    await expect(page.getByText('Apples harvest report').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Deep ocean exploration')).toBeHidden({ timeout: 10000 });

    // Filter by "ocean"
    await search.fill('ocean');
    await expect(page.getByText('Deep ocean exploration').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Apples harvest report')).toBeHidden({ timeout: 10000 });
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
