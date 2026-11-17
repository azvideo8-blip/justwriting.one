import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';

/**
 * CHAOS-H3 (сид 139 двухустройственного хаоса): откат неудачного addLocalCopy
 * снимал с очереди ожидающее удаление облачного ряда.
 *
 * Живой путь: заметка удалена навсегда офлайн → задача 'delete' стоит в очереди
 * (SB-2). До дренажа pull видит живой облачный ряд без локальной пары и заводит
 * копию с тем же uuid (addLocalCopy). Сейф захлопнулся посреди запроса
 * (useEncryptionStore.ts:111-145) → расшифровка падает → откат копии
 * (CloudSyncService.ts:1357 → LocalStorageService.deleteDocument без cloud).
 * Уборка задач удаления локальной строки считала задачу 'delete' своей —
 * и снимала её. Удаление никогда не доходило до облака: заметка воскресала
 * навсегда, соседнее устройство продолжало её править.
 */

const UID = 'u1';
const CLOUD = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeee0003';
const ORIG = 'loc_h3_orig';
const COPY = 'loc_h3_copy';

vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../data', () => ({
  DataProvider: {
    deleteSummary: vi.fn(async () => undefined),
    deleteEmbedding: vi.fn(async () => undefined),
  },
}));
vi.mock('../LocalStoreSyncService', () => ({
  LocalStoreSyncService: { scheduleStoreDelete: vi.fn(), scheduleStoreSync: vi.fn() },
}));
vi.mock('../noteDerivativePurge', () => ({ purgeNoteDerivatives: vi.fn(async () => undefined) }));
vi.mock('../embeddingIndexCache', () => ({ invalidateEmbeddingIndexCache: vi.fn() }));
vi.mock('../../storage/dialogueMerge', () => ({ tombstoneDialogue: vi.fn(async () => undefined) }));

import { LocalDocumentService } from '../LocalDocumentService';

async function seedNote(id: string): Promise<void> {
  const db = await getLocalDb(UID);
  await db.put('documents', {
    id,
    guestId: UID,
    uuid: CLOUD,
    linkedCloudId: CLOUD,
    title: 'заметка',
    firstSessionAt: 1_700_000_000_000,
    lastSessionAt: 1_700_000_000_000,
    currentVersion: 1,
    lastSyncedCloudVersion: 1,
  } as never);
}

async function deleteTasks(): Promise<Array<{ id: string }>> {
  const db = await getLocalDb(UID);
  const all = await db.getAll('syncQueue');
  return all.filter(t => t.type === 'delete' && t.documentId === CLOUD);
}

describe('CHAOS-H3: ожидающее удаление облака переживает откат локальной копии', () => {
  beforeEach(async () => {
    const db = await getLocalDb(UID);
    const tx = db.transaction(['documents', 'syncQueue'], 'readwrite');
    for (const store of ['documents', 'syncQueue'] as const) {
      const rows = await tx.objectStore(store).getAll();
      for (const row of rows) await tx.objectStore(store).delete(row.id);
    }
    await tx.done;
  });

  it('удаление локальной копии без cloud не снимает задачу delete того же uuid', async () => {
    await seedNote(ORIG);
    await LocalDocumentService.deleteDocument(ORIG, UID, { remove: true, cloudId: CLOUD });
    expect(await deleteTasks(), 'удаление заметки поставило задачу сноса облачного ряда').toHaveLength(1);

    // Копия, заведённая addLocalCopy из живого облачного ряда: uuid тот же.
    await seedNote(COPY);
    // Ровно вызов отката из CloudSyncService.ts:1357 — без cloud-опций.
    await LocalDocumentService.deleteDocument(COPY, UID);

    expect(await deleteTasks(), 'ожидающее удаление облака должно пережить откат копии').toHaveLength(1);
  });

  it('новое удаление того же ряда замещает старую задачу, а не плодит дубли', async () => {
    await seedNote(ORIG);
    await LocalDocumentService.deleteDocument(ORIG, UID, { remove: true, cloudId: CLOUD });
    await seedNote(COPY);
    await LocalDocumentService.deleteDocument(COPY, UID, { remove: true, cloudId: CLOUD });
    expect(await deleteTasks()).toHaveLength(1);
  });

  it('выгрузочные задачи удалённой копии по-прежнему снимаются', async () => {
    await seedNote(ORIG);
    await LocalDocumentService.deleteDocument(ORIG, UID, { remove: true, cloudId: CLOUD });
    await seedNote(COPY);
    const db = await getLocalDb(UID);
    await db.put('syncQueue', {
      id: `sync_${COPY}`,
      documentId: COPY,
      type: 'document',
      createdAt: Date.now(),
      ownerId: UID,
    } as never);

    await LocalDocumentService.deleteDocument(COPY, UID);

    const queue = await db.getAll('syncQueue');
    expect(queue.some(t => t.id === `sync_${COPY}`), 'задача выгрузки удалённой копии снята').toBe(false);
    expect(await deleteTasks(), 'задача удаления облака осталась').toHaveLength(1);
  });
});