import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  trashArchiveSession,
  restoreArchiveSession,
  deleteArchiveSession,
  emptyTrash,
  pruneExpiredTrash,
} from '../archiveCrud';
import { ArchiveSession } from '../../types';
import { useActivityLogStore } from '../../../../shared/activity/useActivityLogStore';
import { onDomainEvent } from '../../../../core/events/domainEvents';

vi.mock('../../../../core/services/DocumentService', () => ({
  DocumentService: {
    trashDocument: vi.fn().mockResolvedValue({ cloudSynced: true }),
    restoreDocument: vi.fn().mockResolvedValue({ cloudSynced: true }),
    deleteDocument: vi.fn().mockResolvedValue({ cloudSynced: true }),
  },
}));

vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: {
    trashDocument: vi.fn().mockResolvedValue(undefined),
    restoreDocument: vi.fn().mockResolvedValue(undefined),
    deleteDocument: vi.fn().mockResolvedValue(undefined),
    getDocument: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: {
    trashDocument: vi.fn().mockResolvedValue({ cloudSynced: true }),
    restoreDocument: vi.fn().mockResolvedValue({ cloudSynced: true }),
    deleteDocument: vi.fn().mockResolvedValue({ cloudSynced: true, derivativesOk: true, applied: true }),
  },
}));

import { StorageService } from '../../../../core/services/StorageService';

function makeSession(overrides: Partial<ArchiveSession> = {}): ArchiveSession {
  return {
    id: 's_test_1',
    userId: 'u_test_1',
    content: '',
    duration: 60,
    wordCount: 100,
    charCount: 0,
    wpm: 0,
    title: 'Synthetic test title',
    tags: [],
    createdAt: new Date(),
    _isLegacy: false,
    _isLocal: true,
    _hasCloudCopy: false,
    ...overrides,
  };
}

describe('FEAT-5 Archive Trash Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('trashArchiveSession moves note to trash without physically deleting it', async () => {
    const session = makeSession({ id: 's1', _isLocal: true, _hasCloudCopy: true, _linkedCloudId: 'c1' });
    const addActivitySpy = vi.spyOn(useActivityLogStore.getState(), 'addActivity');

    const domainEvents: unknown[] = [];
    const unsub = onDomainEvent(e => { domainEvents.push(e); });

    const result = await trashArchiveSession(session, 'u1');

    expect(result).toEqual({ cloudSynced: true });
    // StorageService.trashDocument called with (userId, localId, cloudId)
    expect(StorageService.trashDocument).toHaveBeenCalledWith('u1', 's1', 'c1');
    // StorageService.deleteDocument MUST NOT be called (not a physical deletion)
    expect(StorageService.deleteDocument).not.toHaveBeenCalled();

    // Domain event emitted
    expect(domainEvents).toContainEqual({ type: 'note.trashed', documentId: 's1' });

    // Activity log recorded
    expect(addActivitySpy).toHaveBeenCalledWith('activity_note_trashed', undefined, 'info', 'archive');

    unsub();
  });

  it('restoreArchiveSession restores note from trash', async () => {
    const session = makeSession({ id: 's1', trashedAt: Date.now() - 10000 });
    const addActivitySpy = vi.spyOn(useActivityLogStore.getState(), 'addActivity');
    const domainEvents: unknown[] = [];
    const unsub = onDomainEvent(e => { domainEvents.push(e); });

    const result = await restoreArchiveSession(session, 'u1');

    expect(result).toEqual({ cloudSynced: true });
    expect(StorageService.restoreDocument).toHaveBeenCalledWith('u1', 's1', undefined);
    expect(domainEvents).toContainEqual({ type: 'note.restored', documentId: 's1' });
    expect(addActivitySpy).toHaveBeenCalledWith('activity_note_restored', undefined, 'info', 'archive');

    unsub();
  });

  it('deleteArchiveSession permanently deletes note via StorageService.deleteDocument', async () => {
    const session = makeSession({ id: 's1', _isLocal: true, _hasCloudCopy: true, _linkedCloudId: 'c1' });
    const addActivitySpy = vi.spyOn(useActivityLogStore.getState(), 'addActivity');
    const domainEvents: unknown[] = [];
    const unsub = onDomainEvent(e => { domainEvents.push(e); });

    const result = await deleteArchiveSession(session, 'u1');

    expect(result).toEqual({ cloudSynced: true, derivativesOk: true, applied: true });
    expect(StorageService.deleteDocument).toHaveBeenCalledWith('u1', 's1', 'c1');
    // DY6-5: note.deleted эмитит ядро StorageService.deleteDocument (здесь оно замотано)
    // — фича больше не добавляет своё событие: иначе двойная очистка.
    expect(domainEvents).toEqual([]);
    expect(addActivitySpy).toHaveBeenCalledWith('activity_note_deleted', undefined, 'info', 'archive');

    unsub();
  });

  it('emptyTrash permanently deletes each trashed note and logs count in activity log', async () => {
    const addActivitySpy = vi.spyOn(useActivityLogStore.getState(), 'addActivity');
    const s1 = makeSession({ id: 's1' });
    const s2 = makeSession({ id: 's2' });

    const res = await emptyTrash([s1, s2], 'u1');

    expect(res).toEqual({ successCount: 2, failCount: 0, cloudPending: 0, deletedIds: ['s1', 's2'] });
    expect(StorageService.deleteDocument).toHaveBeenCalledTimes(2);
    expect(addActivitySpy).toHaveBeenCalledWith('activity_trash_cleared', { count: 2 }, 'info', 'archive');
  });

  it('pruneExpiredTrash lazily purges notes older than 10 days and keeps newer ones', async () => {
    const now = 1700000000000;
    const elevenDaysAgo = now - (11 * 24 * 60 * 60 * 1000);
    const fiveDaysAgo = now - (5 * 24 * 60 * 60 * 1000);

    const activeSession = makeSession({ id: 'active_1' });
    const recentTrash = makeSession({ id: 'trash_recent', trashedAt: fiveDaysAgo });
    const expiredTrash = makeSession({ id: 'trash_expired', trashedAt: elevenDaysAgo });

    const { prunedCount, remainingSessions } = await pruneExpiredTrash(
      [activeSession, recentTrash, expiredTrash],
      'u1',
      now
    );

    expect(prunedCount).toBe(1);
    expect(remainingSessions.map(s => s.id)).toEqual(['active_1', 'trash_recent']);
    expect(StorageService.deleteDocument).toHaveBeenCalledWith('u1', 'trash_expired', undefined);
    expect(StorageService.deleteDocument).toHaveBeenCalledTimes(1);
  });

  // N-50: удаление, которое не прошло, не выдаётся за прошедшее.
  it('pruneExpiredTrash keeps a note whose deletion failed', async () => {
    const now = 1700000000000;
    const old = now - (11 * 24 * 60 * 60 * 1000);
    vi.mocked(StorageService.deleteDocument)
      .mockResolvedValueOnce({ cloudSynced: true, derivativesOk: true, applied: true })
      .mockRejectedValueOnce(new Error('idb'));
    const a = makeSession({ id: 'exp_ok', trashedAt: old });
    const b = makeSession({ id: 'exp_fail', trashedAt: old });
    const { prunedCount, remainingSessions } = await pruneExpiredTrash([a, b], 'u1', now);
    expect(prunedCount).toBe(1);
    expect(remainingSessions.map(x => x.id)).toEqual(['exp_fail']);
  });

  it('emptyTrash reports what was really deleted and says «not fully» on a failure', async () => {
    const addActivitySpy = vi.spyOn(useActivityLogStore.getState(), 'addActivity');
    vi.mocked(StorageService.deleteDocument)
      .mockResolvedValueOnce({ cloudSynced: true, derivativesOk: true, applied: true })
      .mockRejectedValueOnce(new Error('idb'));
    const res = await emptyTrash([makeSession({ id: 's1' }), makeSession({ id: 's2' })], 'u1');
    expect(res).toEqual({ successCount: 1, failCount: 1, cloudPending: 0, deletedIds: ['s1'] });
    expect(addActivitySpy).toHaveBeenCalledWith('activity_trash_cleared_partial', { success: 1, failed: 1 }, 'warning', 'archive');
  });

  // N-51: заметка удалена, а производные — нет: «удалено навсегда» не пишется.
  it('deleteArchiveSession does not claim «deleted forever» when AI derivatives were left behind', async () => {
    const addActivitySpy = vi.spyOn(useActivityLogStore.getState(), 'addActivity');
    vi.mocked(StorageService.deleteDocument).mockResolvedValueOnce({ cloudSynced: true, derivativesOk: false, applied: true });
    await deleteArchiveSession(makeSession({ id: 's9' }), 'u1');
    expect(addActivitySpy).not.toHaveBeenCalledWith('activity_note_deleted', undefined, 'info', 'archive');
    expect(addActivitySpy).toHaveBeenCalledWith('activity_note_deleted_derivatives', expect.anything(), 'warning', 'archive');
  });

  // N-66: derivativesOk:false не попадает в deletedIds / prunedCount
  it('emptyTrash treats derivativesOk:false as failure (N-66)', async () => {
    vi.mocked(StorageService.deleteDocument).mockResolvedValueOnce({ cloudSynced: true, derivativesOk: false, applied: true });
    const res = await emptyTrash([makeSession({ id: 's_der_fail' })], 'u1');
    expect(res.failCount).toBe(1);
    expect(res.successCount).toBe(0);
    expect(res.deletedIds).toEqual([]);
  });

  it('pruneExpiredTrash keeps note when derivativesOk:false (N-66)', async () => {
    const now = 1700000000000;
    const old = now - (11 * 24 * 60 * 60 * 1000);
    vi.mocked(StorageService.deleteDocument).mockResolvedValueOnce({ cloudSynced: true, derivativesOk: false, applied: true });
    const session = makeSession({ id: 'prune_der_fail', trashedAt: old });
    const { prunedCount, remainingSessions } = await pruneExpiredTrash([session], 'u1', now);
    expect(prunedCount).toBe(0);
    expect(remainingSessions.map(s => s.id)).toEqual(['prune_der_fail']);
  });

  // Дейлик 25.11 (Н-1): облако не приняло — отдельный счёт и строка журнала.
  // Мутации: не считать cloudSynced в emptyTrash / в pruneExpiredTrash — красный.
  it('отказ облака: emptyTrash и pruneExpiredTrash называют отложенное удаление', async () => {
    const addActivitySpy = vi.spyOn(useActivityLogStore.getState(), 'addActivity');
    const refused = { cloudSynced: false, derivativesOk: true, applied: true };
    vi.mocked(StorageService.deleteDocument).mockResolvedValueOnce({ cloudSynced: true, derivativesOk: true, applied: true }).mockResolvedValueOnce(refused);
    const res = await emptyTrash([makeSession({ id: 's_ok' }), makeSession({ id: 's_wait' })], 'u1');
    expect(res).toEqual({ successCount: 2, failCount: 0, cloudPending: 1, deletedIds: ['s_ok', 's_wait'] });
    expect(addActivitySpy).toHaveBeenCalledWith('activity_trash_cloud_pending', { count: 1 }, 'warning', 'archive');

    addActivitySpy.mockClear();
    const now = 1700000000000;
    vi.mocked(StorageService.deleteDocument).mockResolvedValueOnce(refused);
    await pruneExpiredTrash([makeSession({ id: 's_exp', trashedAt: now - 11 * 24 * 60 * 60 * 1000 })], 'u1', now);
    expect(addActivitySpy.mock.calls).toEqual([['activity_trash_cloud_pending', { count: 1 }, 'warning', 'archive']]);
  });
});
