// DI-6: «Выводы из разговоров» на телефоне — раздел на /me, возврат в разговор,
// удаление с подтверждением. Диалог и вывод сеются прямо в IndexedDB, флаг
// chat_insights включается строкой в feature_flags базы стенда (аккаунт — admin):
// page.route на webkit не перехватывает rpc, а строка гоняет реальный путь флага.
import { expect, test } from '@playwright/test';
import { grantAiConsent, grantChatInsightsFlag, revokeChatInsightsFlag, shot, signInMobile, unlockVaultIfAsked, waitForNavigationSettled } from './harness';

test.use({ viewport: { width: 390, height: 844 } });

test.afterEach(() => {
  revokeChatInsightsFlag();
});

test('вывод из разговора: раздел на /me, возврат в диалог, удаление', async ({ page }) => {
  const acc = await signInMobile(page, 'di6-insights');
  grantAiConsent(acc.uid);
  grantChatInsightsFlag();

  await page.reload();
  await unlockVaultIfAsked(page, acc.password);

  const now = Date.now();
  await page.evaluate(async ({ uid, now }) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open(`justwriting-local-${uid}`);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(['aiDialogues', 'aiChatMemory'], 'readwrite');
      tx.objectStore('aiDialogues').put({
        id: 'di6-dlg',
        title: 'Synthetic dialogue',
        personaId: 'coach',
        personaName: 'Коуч',
        personaEmoji: '🧭',
        messages: [
          { id: 'di6-m1', role: 'user', content: 'synthetic question', createdAt: now },
          { id: 'di6-m2', role: 'assistant', content: 'synthetic reply', createdAt: now },
        ],
        createdAt: now,
        updatedAt: now,
        schema: 2,
      });
      tx.objectStore('aiChatMemory').put({
        id: 'di6-ins',
        kind: 'conclusion',
        text: 'Synthetic takeaway',
        context: 'synthetic question',
        sourceDialogueId: 'di6-dlg',
        sourceMessageId: 'di6-m2',
        sourceDocumentIds: [],
        confirmedAt: now,
        confirmedBy: 'reply',
        createdAt: now,
        updatedAt: now,
      });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, { uid: acc.uid, now });

  await page.goto('/me');
  const row = page.getByTestId('insight-row-di6-ins');
  await expect(row, 'раздел с выводом не появился на /me').toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText('Synthetic takeaway');
  await expect(row).toContainText('подтверждено тобой');
  await shot(page, 'di6-me-insights');

  await row.getByRole('button', { name: 'Открыть разговор' }).click();
  await waitForNavigationSettled(page);
  expect(page.url()).toContain('/ai');
  expect(page.url(), 'параметр dialogue не потреблён').not.toContain('dialogue=');
  await expect(page.getByText('synthetic reply').first(), 'разговор не открылся').toBeVisible({ timeout: 20_000 });
  await shot(page, 'di6-dialogue-opened');

  await page.goto('/me');
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole('button', { name: 'Удалить' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('Удалить вывод?');
  await dlg.getByRole('button', { name: 'Удалить' }).click();
  await expect(row, 'строка не исчезла после удаления').toBeHidden({ timeout: 10_000 });

  await page.reload();
  await unlockVaultIfAsked(page, acc.password);
  await expect(page.getByText('Выводы из разговоров')).toBeVisible({ timeout: 20_000 });
  await expect(row, 'удалённый вывод вернулся после перезагрузки').toBeHidden();
  await shot(page, 'di6-after-delete');
});