// Дейлик 03.11 Н-3 (красный тест аудитора d34b): счёт гостевого = стёртое гостевое.
// все данные" … заранее показывает их число». `countGuestEntriesInSharedDb`
// обещает (свой docstring, src/core/storage/localDb.ts:1005-1008) «считает то же,
// что удалит wipeGuestAndAccountFromSharedDb», но проходит только по documents,
// versions и drafts, тогда как стирание идёт по всем OWNED_SHARED_STORES
// (localDb.ts:958): profile (гостевой профиль — LocalDocumentService.ts:621-622)
// и syncQueue.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  countGuestEntriesInSharedDb,
  getLocalDb,
  resetDbInstance,
  wipeGuestAndAccountFromSharedDb,
} from '@/core/storage/localDb';

const SHARED = 'justwriting-local';
const GUEST = 'guest_d34b';
const LEAVING_UID = 'u_d34b_leaving';
const OTHER_UID = 'u_d34b_other';
const OWNED = ['documents', 'versions', 'profile', 'drafts', 'syncQueue', 'pending_sessions'];

async function dropShared(): Promise<void> {
  resetDbInstance(SHARED);
  await new Promise<void>(resolve => {
    const req = indexedDB.deleteDatabase(SHARED);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

async function total(): Promise<number> {
  const db = await getLocalDb(SHARED);
  let n = 0;
  for (const name of OWNED) {
    if (db.objectStoreNames.contains(name as never)) n += await db.count(name as never);
  }
  return n;
}

beforeEach(async () => {
  localStorage.clear();
  await dropShared();
});

describe('d34b: счёт «Записи без входа» обязан равняться тому, что реально стирается', () => {
  it('гостевой профиль и строки syncQueue уходят, но в счёт не попадают', async () => {
    const db = await getLocalDb(SHARED);
    // Гостевое, которое счёт видит.
    await db.put('documents', { id: 'gd34b', guestId: GUEST, title: 'MARKER_D34B_гост_заметка', currentVersion: 1 } as never);
    await db.put('versions', { id: 'gv34b', documentId: 'gd34b', guestId: GUEST, version: 1, content: 'MARKER_D34B_гост_текст' } as never);
    await db.put('drafts', { userId: GUEST, content: 'MARKER_D34B_гост_черновик', updatedAt: 1 } as never);
    // Гостевое, которого в списке хранилищ счёта нет.
    await db.put('profile', { guestId: GUEST, nickname: 'MARKER_D34B_гость', createdAt: 1 } as never);
    await db.put('syncQueue', { id: 'sq34b_1', docId: 'gd34b', op: 'save' } as never);
    await db.put('syncQueue', { id: 'sq34b_2', docId: 'gd34b', op: 'version' } as never);
    // Чужой аккаунт — его выход не касается, и база не должна быть удалена целиком.
    await db.put('documents', { id: 'od34b', guestId: OTHER_UID, title: 'MARKER_D34B_чужая_заметка', currentVersion: 1 } as never);

    const before = await total();
    const counted = await countGuestEntriesInSharedDb();
    await wipeGuestAndAccountFromSharedDb(LEAVING_UID);
    const removed = before - (await total());

    expect(removed, 'проверка харнесса: стирание убрало гостевые строки').toBeGreaterThan(0);
    expect(counted, `счёт показал ${counted}, а стёрто ${removed} строк общей базы`).toBe(removed);
  });
});
