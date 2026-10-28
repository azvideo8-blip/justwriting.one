import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

// S1-14: выключенный флаг = 0.10.x. Входы «вход / сеть вернулась / сейф
// открыт» в 0.10.x делали только downloadAllFromCloud; сверка связанных
// (reconcileLinkedDocuments) шла только с проверкой курсора на видимости.
// pullNotesOldPath делал download + reconcile — это не «ровно как в 0.10.x».

const downloadAllFromCloud = vi.fn(async () => ({ downloaded: 1, skipped: 0, failed: 0 }));
const reconcileLinkedDocuments = vi.fn(async () => ({ reconciled: 0, skipped: 0, failed: 0, corrupted: 0 }));
const pullNotesByRev = vi.fn();

vi.mock('../../sync/syncFlags', () => ({ syncPullByRevEnabled: async () => false }));
vi.mock('../CloudSyncService', () => ({
  CloudSyncService: { downloadAllFromCloud, reconcileLinkedDocuments, pullNotesByRev },
  CLOUD_COPY_LOCAL_ONLY: 'LOCAL_ONLY',
  CLOUD_COPY_TOMBSTONE: 'TOMBSTONE',
}));
vi.mock('../../utils/streakFreeze', () => ({ syncStreakFreezesWithCloud: vi.fn(async () => undefined) }));
vi.mock('../syncQueueOps', () => ({ announceQueueChange: vi.fn(), addToSyncQueue: vi.fn() }));

const { SyncService } = await import('../SyncService');

describe('S1-14: SYNC_PULL_BY_REV=false — the old path is download only', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pullNotes calls downloadAllFromCloud and never reconcileLinkedDocuments', async () => {
    const res = await SyncService.pullNotes('u_flag_off');
    expect(downloadAllFromCloud).toHaveBeenCalledWith('u_flag_off', undefined);
    expect(reconcileLinkedDocuments).not.toHaveBeenCalled();
    expect(pullNotesByRev).not.toHaveBeenCalled();
    expect(res).toMatchObject({ downloaded: 1, reconciled: 0, documentsRev: 0, versionsRev: 0 });
  });

  it('a locked vault short-circuits without reconciling', async () => {
    downloadAllFromCloud.mockResolvedValueOnce({ downloaded: 0, skipped: 0, failed: 0, locked: true } as never);
    const res = await SyncService.pullNotes('u_flag_off');
    expect(res.locked).toBe(true);
    expect(reconcileLinkedDocuments).not.toHaveBeenCalled();
  });
});
