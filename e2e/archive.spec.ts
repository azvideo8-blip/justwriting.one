import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('app_language', 'en');
  });
});

/**
 * Кладёт две заметки в ту же базу, которую читает приложение.
 *
 * Здесь были две ошибки, из-за которых тест не проходил ни разу ни в одном
 * браузере, а падал по таймауту:
 *
 * 1. База открывалась с жёсткой версией и без `onupgradeneeded`. На чистом
 *    профиле базы ещё нет, открытие требует создать схему, хранилищ не
 *    появляется — и `db.transaction([...])` бросает ВНУТРИ обработчика события,
 *    откуда исключение в промис не попадает. Промис не разрешался никогда.
 *    Поэтому: схему создаёт приложение, а тест ждёт её и открывает без версии.
 *
 * 2. Владельцем ставилась строка `guest`, а приложение живёт под
 *    `guest_<uuid>` из localStorage и по нему же фильтрует. Заметки с чужим
 *    владельцем в списке и не должны появляться. Владелец читается из
 *    хранилища страницы.
 */
async function seedNotes(page: import('@playwright/test').Page): Promise<void> {
  // Ждём, пока приложение само создаст базу со всеми хранилищами. Одного имени
  // мало (0.10.0): Chrome перечисляет базу, пока её создание ещё не началось, и
  // открытие без версии отсюда само становилось создателем — пустая база без
  // хранилищ. С выносом синхронизации (N-2) приложение открывает базу позже, и
  // гонка стала постоянной. Ждём версию приложения (> 1).
  await page.waitForFunction(async () => {
    const dbs = await indexedDB.databases?.();
    return Boolean(dbs?.some(d => d.name === 'justwriting-local' && (d.version ?? 0) > 1));
  }, undefined, { timeout: 15000 });

  const missing = await page.evaluate(async () => {
    const guestId = localStorage.getItem('jw_guest_id') ?? 'guest';
    // Открытие без версии в окне, когда база ещё не создана приложением, само
    // становится создателем пустой базы. Такое открытие отменяем (abort в
    // upgradeneeded) и повторяем, пока не откроется база приложения со схемой.
    const tryOpen = () => new Promise<IDBDatabase | null>((resolve, reject) => {
      const req = indexedDB.open('justwriting-local');
      req.onupgradeneeded = () => { req.transaction?.abort(); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => (req.error?.name === 'AbortError' ? resolve(null) : reject(req.error));
      req.onblocked = () => resolve(null);
    });
    let db: IDBDatabase | null = null;
    for (let i = 0; i < 50 && db === null; i++) {
      db = await tryOpen();
      if (db === null) await new Promise(r => setTimeout(r, 200));
    }
    if (db === null) return 'база приложения не появилась за 10 с';
    for (const store of ['documents', 'versions']) {
      if (!db.objectStoreNames.contains(store)) return `нет хранилища ${store}`;
    }

    const now = Date.now();
    const notes = [
      { id: 'doc_alpha', title: 'Apples harvest report', tags: ['orchard'],
        verId: 'ver_alpha', content: 'Apples were harvested in great quantities today.' },
      { id: 'doc_beta', title: 'Deep ocean exploration', tags: ['sea'],
        verId: 'ver_beta', content: 'The deep ocean holds pressures no diver survives.' },
    ];

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['documents', 'versions'], 'readwrite');
      const docs = tx.objectStore('documents');
      const vers = tx.objectStore('versions');
      for (const n of notes) {
        docs.put({
          id: n.id, guestId, title: n.title, currentVersion: 1,
          totalWords: 10, totalDuration: 60, sessionsCount: 1,
          firstSessionAt: now, lastSessionAt: now, tags: n.tags,
        });
        vers.put({
          id: n.verId, documentId: n.id, guestId, version: 1,
          content: n.content, wordCount: 10, wordsAdded: 10, charsAdded: 48,
          duration: 60, wpm: 10, createdAt: now, savedAt: now,
        });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
    });
    db.close();
    return '';
  });

  // Пустой посев — это молчаливый провал: список окажется пустым, и тест
  // отчитается о фильтрации, ничего не отфильтровав.
  if (missing) throw new Error(`посев не выполнен: ${missing}`);
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

  // R5 (emil-review, хвост MQ-15): затемнение десктопного превью стояло вне
  // AnimatePresence и появлялось/пропадало рывком. Правка — только это: подложка
  // гаснет за 200 мс по прозрачности вместе с окном; карточка превью, её содержимое
  // и слои не изменены. На телефоне этого слоя нет.
  test('R5: подложка превью появляется и гаснет с переходом', async ({ page }) => {
    await page.goto('/archive');
    await seedNotes(page);
    await page.reload();
    // На десктопе название — переименование по двойному нажатию; превью
    // открывает строка с текстом заметки.
    await page.getByText('Apples were harvested in great quantities today.').first().click({ timeout: 15000 });
    // Превью открывается после загрузки текста заметки (асинхронно) — дольше
    // окна замера появления; без ожидания замер шёл по пустому месту. Кадры
    // перехода достаточно поймать на исчезновении.
    await page.locator('[class*="bg-black/20"]').first().waitFor({ state: 'attached', timeout: 10_000 });

    const seen = await page.evaluate(() => new Promise<{ inFrames: number[]; outFrames: number[] }>(resolve => {
      const sel = '[class*="bg-black/20"]';
      const inFrames: number[] = [];
      const outFrames: number[] = [];
      const started = performance.now();
      const tickIn = () => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el) inFrames.push(Number(getComputedStyle(el).opacity));
        if (inFrames.length < 12 && performance.now() - started < 600) requestAnimationFrame(tickIn);
        else closeAndSample();
      };
      const closeAndSample = () => {
        const el = document.querySelector(sel) as HTMLElement | null;
        const start2 = performance.now();
        el?.click();
        const tickOut = () => {
          const e2 = document.querySelector(sel) as HTMLElement | null;
          if (e2) outFrames.push(Number(getComputedStyle(e2).opacity));
          if (performance.now() - start2 < 500) requestAnimationFrame(tickOut);
          else resolve({ inFrames, outFrames });
        };
        requestAnimationFrame(tickOut);
      };
      requestAnimationFrame(tickIn);
    }));

    const partialIn = seen.inFrames.filter(o => o > 0.01 && o < 0.99);
    const partialOut = seen.outFrames.filter(o => o > 0.01 && o < 0.99);
    expect(partialIn.length + partialOut.length,
      `подложка скачет между 0 и 1 без кадров перехода: in=${JSON.stringify(seen.inFrames.slice(0, 6))} out=${JSON.stringify(seen.outFrames.slice(0, 6))}`)
      .toBeGreaterThan(0);
  });
});
