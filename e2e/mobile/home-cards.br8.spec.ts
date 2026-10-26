// BR-8 (ревью 25.10): новые элементы главного раньше не проверялись нигде —
// прогон 141/141 шёл на аккаунтах без истории, и карточки не рисовались.
// Спек сеет историю (запись вчера, запись три дня назад, запись год назад) и
// проверяет, что на телефоне видно карточку возврата, строку «В этот день»,
// полосу несинхронизированного и чип серии.
//
// Историю пишем в IndexedDB того же аккаунта после реальной записи через
// редактор: даты `firstSessionAt`/`lastSessionAt` — те же поля, что читает
// `pickReturnNote`, `useOnThisDayHome` и `calculateStreak`. Дальше офлайн,
// чтобы полоса стояла, а не дренажнулась на середине спека.
import { expect, test } from '@playwright/test';
import { openVaultFromBanner, shot, signInMobile, zenOff } from './harness';

const DAY = 86_400_000;

async function seedHistory(page: import('@playwright/test').Page, uid: string) {
  await page.evaluate(async ({ uid, DAY }) => {
    const name = `justwriting-local-${uid}`;
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const req = indexedDB.open(name);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const tx = db.transaction('documents', 'readwrite');
    const store = tx.objectStore('documents');
    type Row = { id: string; firstSessionAt?: number; lastSessionAt?: number; uuid?: string; title?: string };
    const all = await new Promise<Row[]>((res, rej) => {
      const req = store.getAll();
      req.onsuccess = () => res(req.result as Row[]);
      req.onerror = () => rej(req.error);
    });
    const base = all[all.length - 1];
    if (!base) throw new Error('нет ни одной заметки — посев нечего клонировать');
    const now = Date.now();
    const mk = (id: string, agoDays: number) => ({
      ...base,
      id,
      // Индекс `by-uuid` уникален: клон обязан принести свой uuid, иначе
      // посев падает ConstraintError.
      uuid: crypto.randomUUID(),
      // Чужая облачная ссылка клону не достаётся: с ней дренаж выгрузил бы
      // вымышленную заметку поверх строки оригинала. Без ссылки строка
      // «unlinked» — то есть честно несинхронизированная.
      linkedCloudId: undefined,
      lastSyncedCloudVersion: undefined,
      title: `${base.title ?? 'запись'} · ${agoDays} дн. назад`,
      firstSessionAt: now - agoDays * DAY,
      lastSessionAt: now - agoDays * DAY,
      trashedAt: undefined,
      excludedFromAI: false,
    });
    // Вчерашняя: её же и оставим, сдвинув дату, — самый свежий день до паузы.
    const yesterday = { ...base, id: `${base.id}`, firstSessionAt: now - 1 * DAY, lastSessionAt: now - 1 * DAY };
    await new Promise((res, rej) => {
      const putA = store.put(yesterday);
      putA.onsuccess = () => res(null);
      putA.onerror = () => rej(putA.error);
    });
    await new Promise((res, rej) => {
      const putB = store.put(mk('br8_three_days', 3));
      putB.onsuccess = () => res(null);
      putB.onerror = () => rej(putB.error);
    });
    await new Promise((res, rej) => {
      const putC = store.put(mk('br8_year_ago', 365));
      putC.onsuccess = () => res(null);
      putC.onerror = () => rej(putC.error);
    });
    // Несинхронизированная задача: заметка «в устройстве», облачной копии нет.
    const qtx = db.transaction('syncQueue', 'readwrite');
    await new Promise((res, rej) => {
      const putQ = qtx.objectStore('syncQueue').put({
        id: 'sync_br8_year_ago',
        documentId: 'br8_year_ago',
        type: 'document',
        createdAt: now,
        ownerId: uid,
      });
      putQ.onsuccess = () => res(null);
      putQ.onerror = () => rej(putQ.error);
    });
    db.close();
  }, { uid, DAY });
}

for (const { w, h } of [{ w: 360, h: 640 }, { w: 390, h: 844 }]) {
  test.describe(`BR-8: главный с историей на ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('карточка возврата, «В этот день», полоса синка и чип серии — видны', async ({ page, context }) => {
      await zenOff(page);
      const account = await signInMobile(page, `br8-${w}`);
      await openVaultFromBanner(page, account.password);

      // Одна реальная запись через редактор: она даёт документ нужной формы
      // (теги, версии, шифрование — как у человека).
      const editor = page.locator('textarea').first();
      await editor.waitFor({ state: 'visible', timeout: 30_000 });
      await editor.fill('BR8 основа. Раз два три четыре пять.');
      await page.locator('[data-write-toolbar]').getByRole('button', { name: /^Сохранить$/ }).click();
      const dialog = page.getByRole('dialog').first();
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await dialog.getByRole('button', { name: /^Сохранить$/ }).click();
      await expect(editor).toBeEmpty({ timeout: 15_000 });

      await seedHistory(page, account.uid);

      // Перезагрузка при связи: офлайн до reload убивает сам бандл (страница
      // пустая), поэтому сначала грузимся, потом рвём сеть.
      await page.reload();
      await zenOff(page);
      await openVaultFromBanner(page, account.password);

      const returnCard = page.getByTestId('return-to-writing');
      await expect(returnCard, 'карточки возврата нет').toBeVisible({ timeout: 30_000 });
      await expect(returnCard).toContainText('Последняя запись');

      // BR-7: напоминание — строкой под «Продолжить», только название.
      const memory = page.getByText(/В этот день/).first();
      await expect(memory, 'строки «В этот день» нет').toBeVisible({ timeout: 30_000 });
      await expect(memory.locator('xpath=preceding::*[@data-testid="return-to-writing"][1]')).toBeVisible();

      await expect(page.getByTestId('streak-chip'), 'чип серии нет').toBeVisible();

      // Полоса «Не синхронизировано»: рвём сеть и сохраняем заметку — ровно тот
      // путь, ради которого RA1-4 и делался (офлайн-финиш RA1-2 + счётчик).
      await context.setOffline(true);
      const editor2 = page.locator('textarea').first();
      await editor2.waitFor({ state: 'visible', timeout: 30_000 });
      await editor2.fill('BR8 офлайн. Раз два три четыре пять.');
      await page.locator('[data-write-toolbar]').getByRole('button', { name: /^Сохранить$/ }).click();
      const dialog2 = page.getByRole('dialog').first();
      await expect(dialog2).toBeVisible({ timeout: 20_000 });
      await dialog2.getByRole('button', { name: /^Сохранить$/ }).click();

      const bar = page.getByTestId('sync-unsynced-bar');
      await expect(bar, 'полосы несинхронизированного нет').toBeVisible({ timeout: 30_000 });
      // В офлайне строка честно говорит «сети нет» вместо счётчика
      // (`sync_paused_no_network`), в онлайне — «Не синхронизировано: N».
      await expect(bar).toContainText(/Не синхронизировано|Синхронизация приостановлена|нет сети/i);

      await shot(page, `br8-home-history-${w}`);
      await context.setOffline(false);
    });
  });
}
