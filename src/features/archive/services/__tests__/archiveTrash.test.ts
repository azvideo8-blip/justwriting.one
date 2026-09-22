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
    deleteDocument: vi.fn().mockResolvedValue({ cloudSynced: true }),
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
    expect(addActivitySpy).toHaveBeenCalledWith('заметка удалена в корзину', undefined, 'info', 'archive');

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
    expect(addActivitySpy).toHaveBeenCalledWith('заметка восстановлена из корзины', undefined, 'info', 'archive');

    unsub();
  });

  it('deleteArchiveSession permanently deletes note via StorageService.deleteDocument', async () => {
    const session = makeSession({ id: 's1', _isLocal: true, _hasCloudCopy: true, _linkedCloudId: 'c1' });
    const addActivitySpy = vi.spyOn(useActivityLogStore.getState(), 'addActivity');
    const domainEvents: unknown[] = [];
    const unsub = onDomainEvent(e => { domainEvents.push(e); });

    const result = await deleteArchiveSession(session, 'u1');

    expect(result).toEqual({ cloudSynced: true });
    expect(StorageService.deleteDocument).toHaveBeenCalledWith('u1', 's1', 'c1');
    expect(domainEvents).toContainEqual({ type: 'note.deleted', documentId: 's1' });
    expect(addActivitySpy).toHaveBeenCalledWith('заметка удалена навсегда', undefined, 'info', 'archive');

    unsub();
  });

  it('emptyTrash permanently deletes each trashed note and logs count in activity log', async () => {
    const addActivitySpy = vi.spyOn(useActivityLogStore.getState(), 'addActivity');
    const s1 = makeSession({ id: 's1' });
    const s2 = makeSession({ id: 's2' });

    const res = await emptyTrash([s1, s2], 'u1');

    expect(res).toEqual({ successCount: 2, failCount: 0 });
    expect(StorageService.deleteDocument).toHaveBeenCalledTimes(2);
    expect(addActivitySpy).toHaveBeenCalledWith('корзина очищена (2)', undefined, 'info', 'archive');
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
});
