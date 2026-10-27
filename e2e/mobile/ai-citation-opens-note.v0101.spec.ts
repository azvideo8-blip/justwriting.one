// Наблюдение владельца 2026-10-17 (iPhone): в ответах ИИ значки «📅 дата» —
// ссылки на заметки — на телефоне никак не реагируют на нажатие. Заглушка ИИ на
// стенде повторяет сообщение человека. `[#id]` в ответе выживает, только если
// заметка есть в контексте хода (страж ссылок вырезает остальные), поэтому
// заметка уходит в разговор через «Обсудить с ИИ», а вопрос называет её id.
import { expect, test } from '@playwright/test';
import { grantAiConsent, signInMobile, unlockVaultIfAsked, waitForNavigationSettled } from './harness';

test.use({ viewport: { width: 390, height: 844 } });

test('«📅» в ответе ИИ открывает заметку на телефоне', async ({ page }) => {
  const acc = await signInMobile(page, 'v0101-cite');

  grantAiConsent(acc.uid);
  await page.reload();
  await unlockVaultIfAsked(page, acc.password);

  // Заметка, на которую будет ссылка: сохраняем и сразу обсуждаем с ИИ.
  await page.goto('/');
  const editor = page.locator('textarea').first();
  await editor.waitFor({ state: 'visible', timeout: 30_000 });
  await editor.fill('Заметка для ссылки из ответа ИИ. Вторая фраза.');
  await page.locator('[data-write-toolbar]').getByRole('button', { name: /^Сохранить$/ }).click();
  const finish = page.locator('[aria-labelledby="finish-modal-title"]');
  await expect(finish).toBeVisible({ timeout: 15_000 });
  await finish.getByRole('button', { name: /Обсудить с ИИ/ }).click();
  await expect(finish).toBeHidden({ timeout: 20_000 });
  await waitForNavigationSettled(page);

  const docId = await page.evaluate(async (uid) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open(`justwriting-local-${uid}`);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const ids = await new Promise<string[]>((res, rej) => {
      const r = db.transaction('documents').objectStore('documents').getAllKeys();
      r.onsuccess = () => res(r.result.map(String));
      r.onerror = () => rej(r.error);
    });
    db.close();
    return ids[0] ?? '';
  }, acc.uid);
  expect(docId, 'заметка не сохранилась локально').not.toBe('');

  const composer = page.locator('textarea').last();
  await composer.waitFor({ state: 'visible', timeout: 30_000 });
  await composer.fill(`смотри [#${docId}]`);
  await page.getByRole('button', { name: /Отправить/ }).click();

  const cite = page.locator('a[href^="#cite-"], button:has-text("📅")').last();
  await expect(cite, 'в ответе нет ссылки на заметку').toBeVisible({ timeout: 40_000 });
  await cite.click();
  await expect(page.getByTestId('note-reader'), 'ссылка не открыла заметку').toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('note-reader').getByText('Заметка для ссылки из ответа ИИ.').first()).toBeVisible();
});
