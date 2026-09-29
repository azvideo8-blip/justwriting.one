// R3-008: удаление заметки снимает её задачи очереди, но не строку живого замка
// lock_cloud_<id> — её снимает владелец (withDocumentLock). Иначе heartbeat
// чужой выгрузки молча прекращался, и замок доставался второму писателю.
import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { LocalDocumentService } from '../LocalDocumentService';
import { getLocalDb } from '../../storage/localDb';

vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../LocalStoreSyncService', () => ({
  LocalStoreSyncService: { scheduleStoreDelete: vi.fn(), scheduleStoreSync: vi.fn() },
}));

describe('LocalDocumentService.deleteDocument', () => {
  it('убирает задачи заметки и оставляет строку живого замка', async () => {
    const db = await getLocalDb('u1');
    await db.put('documents', { id: 'local_1', title: 't', currentVersion: 1, guestId: 'u1' } as never);
    await db.put('syncQueue', { id: 'sync_local_1', documentId: 'local_1', type: 'upsert', createdAt: 1 } as never);
    await db.put('syncQueue', { id: 'lock_cloud_local_1', documentId: 'local_1', type: 'lock', createdAt: 1, ownerToken: 'tab-B', expiresAt: Date.now() + 30_000 } as never);

    await LocalDocumentService.deleteDocument('local_1', 'u1');

    const ids = (await db.getAll('syncQueue')).map(t => t.id);
    expect(ids).not.toContain('sync_local_1');
    expect(ids).toContain('lock_cloud_local_1');
  });
});
