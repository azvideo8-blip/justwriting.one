import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { CloudSyncService } from '../CloudSyncService';
import { DocumentService } from '../DocumentService';
import { LocalStorageService } from '../LocalStorageService';
import * as WriteBudget from '../../firebase/writeBudget';

vi.mock('../../firebase/firestore', () => ({ isFirestoreConnected: true }));

vi.mock('../../firebase/writeBudget', () => ({
  areCloudWritesBlockedToday: vi.fn(),
  tryReserveBulkWriteBudget: vi.fn(),
  blockCloudWritesToday: vi.fn(),
  isGlobalWriteFailure: vi.fn(),
}));

describe('CloudSyncService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('restoreMissingDocuments', () => {
    it('returns { restored: 0, hasMore: true } when writes are blocked', async () => {
      vi.mocked(WriteBudget.areCloudWritesBlockedToday).mockReturnValue(true);

      const result = await CloudSyncService.restoreMissingDocuments('user_1');
      expect(result).toEqual({ restored: 0, hasMore: true });
    });

    it('returns early when budget runs out', async () => {
      vi.mocked(WriteBudget.areCloudWritesBlockedToday).mockReturnValue(false);
      vi.mocked(WriteBudget.tryReserveBulkWriteBudget)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([
        { id: 'cloud_1' } as any,
        { id: 'cloud_2' } as any,
      ]);
      vi.spyOn(LocalStorageService, 'getGuestDocuments').mockResolvedValue([]);
      const addLocalCopySpy = vi.spyOn(CloudSyncService, 'addLocalCopy').mockResolvedValue('local_1');

      const result = await CloudSyncService.restoreMissingDocuments('user_1');
      expect(result).toEqual({ restored: 1, hasMore: true });
      expect(addLocalCopySpy).toHaveBeenCalledTimes(1);
    });

    it('returns hasMore false when all documents restored successfully', async () => {
      vi.mocked(WriteBudget.areCloudWritesBlockedToday).mockReturnValue(false);
      vi.mocked(WriteBudget.tryReserveBulkWriteBudget).mockReturnValue(true);

      vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([
        { id: 'cloud_1' } as any,
        { id: 'cloud_2' } as any,
      ]);
      vi.spyOn(LocalStorageService, 'getGuestDocuments').mockResolvedValue([]);
      const addLocalCopySpy = vi.spyOn(CloudSyncService, 'addLocalCopy').mockResolvedValue('local_1');

      const result = await CloudSyncService.restoreMissingDocuments('user_1');
      expect(result).toEqual({ restored: 2, hasMore: false });
      expect(addLocalCopySpy).toHaveBeenCalledTimes(2);
    });

    it('re-links an unlinked local note instead of downloading a second copy', async () => {
      vi.mocked(WriteBudget.areCloudWritesBlockedToday).mockReturnValue(false);
      vi.mocked(WriteBudget.tryReserveBulkWriteBudget).mockReturnValue(true);

      vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([
        { id: 'cloud_1', firstSessionAt: new Date(1000), lastSessionAt: new Date(2000) } as any,
      ]);
      vi.spyOn(LocalStorageService, 'getGuestDocuments').mockResolvedValue([
        { id: 'local_1', firstSessionAt: 1000 } as any,
      ]);
      const updateLink = vi.spyOn(LocalStorageService, 'updateLinkedCloudId').mockResolvedValue(undefined);
      const addLocalCopySpy = vi.spyOn(CloudSyncService, 'addLocalCopy').mockResolvedValue('local_9');

      const result = await CloudSyncService.restoreMissingDocuments('user_1');

      expect(updateLink).toHaveBeenCalledWith('local_1', 'cloud_1');
      expect(addLocalCopySpy).not.toHaveBeenCalled();
      expect(result).toEqual({ restored: 0, hasMore: false });
    });
  });

  describe('relinkOrphanedDocuments', () => {
    const cloudDoc = (id: string, startMs: number) =>
      ({ id, firstSessionAt: new Date(startMs), lastSessionAt: new Date(startMs) }) as any;

    it('does not read the cloud when there is nothing to re-link', async () => {
      vi.spyOn(LocalStorageService, 'getGuestDocuments').mockResolvedValue([
        { id: 'local_1', firstSessionAt: 1000, linkedCloudId: 'cloud_1' } as any,
      ]);
      const cloudRead = vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([]);

      expect(await CloudSyncService.relinkOrphanedDocuments('user_1')).toBe(0);
      expect(cloudRead).not.toHaveBeenCalled();
    });

    it('leaves a deliberately unlinked note alone', async () => {
      vi.spyOn(LocalStorageService, 'getGuestDocuments').mockResolvedValue([
        { id: 'local_1', firstSessionAt: 1000, localOnly: true } as any,
      ]);
      const cloudRead = vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([]);

      expect(await CloudSyncService.relinkOrphanedDocuments('user_1')).toBe(0);
      expect(cloudRead).not.toHaveBeenCalled();
    });

    it('skips ambiguous matches rather than guessing', async () => {
      vi.spyOn(LocalStorageService, 'getGuestDocuments').mockResolvedValue([
        { id: 'local_1', firstSessionAt: 1000 } as any,
        { id: 'local_2', firstSessionAt: 1000 } as any,
        { id: 'local_3', firstSessionAt: 3000 } as any,
      ]);
      vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([
        cloudDoc('cloud_1', 1000),
        cloudDoc('cloud_2', 1000),
        cloudDoc('cloud_3', 3000),
      ]);
      const updateLink = vi.spyOn(LocalStorageService, 'updateLinkedCloudId').mockResolvedValue(undefined);

      expect(await CloudSyncService.relinkOrphanedDocuments('user_1')).toBe(1);
      expect(updateLink).toHaveBeenCalledTimes(1);
      expect(updateLink).toHaveBeenCalledWith('local_3', 'cloud_3');
    });

    it('never hands a cloud copy to two local notes', async () => {
      vi.spyOn(LocalStorageService, 'getGuestDocuments').mockResolvedValue([
        { id: 'local_1', firstSessionAt: 1000, linkedCloudId: 'cloud_1' } as any,
        { id: 'local_2', firstSessionAt: 1000 } as any,
      ]);
      vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([cloudDoc('cloud_1', 1000)]);
      const updateLink = vi.spyOn(LocalStorageService, 'updateLinkedCloudId').mockResolvedValue(undefined);

      expect(await CloudSyncService.relinkOrphanedDocuments('user_1')).toBe(0);
      expect(updateLink).not.toHaveBeenCalled();
    });

    it('propagates a failed cloud read instead of reporting "nothing matched"', async () => {
      vi.spyOn(LocalStorageService, 'getGuestDocuments').mockResolvedValue([
        { id: 'local_1', firstSessionAt: 1000 } as any,
      ]);
      vi.spyOn(DocumentService, 'getUserDocuments').mockRejectedValue(new Error('unavailable'));

      await expect(CloudSyncService.relinkOrphanedDocuments('user_1')).rejects.toThrow('unavailable');
    });
  });
});

// The cloud trims old snapshots (pruneOldVersions). An older version missing
// there is housekeeping, not a gap — re-uploading it would undo the trim and
// pay the write quota to do it on every sync, forever.
describe('addCloudCopy — pruned history is not re-uploaded', () => {
  it('uploads only versions newer than the newest the cloud holds', async () => {
    vi.mocked(WriteBudget.areCloudWritesBlockedToday).mockReturnValue(false);
    vi.mocked(WriteBudget.tryReserveBulkWriteBudget).mockReturnValue(true);

    const { LocalVersionService } = await import('../LocalVersionService');
    const { VersionService } = await import('../VersionService');
    const { DocumentService } = await import('../DocumentService');

    vi.spyOn(LocalStorageService, 'getDocument').mockResolvedValue({
      id: 'local_1', linkedCloudId: 'cloud_1', currentVersion: 12,
      totalWords: 10, totalDuration: 0, sessionsCount: 1,
    } as never);
    vi.spyOn(DocumentService, 'getDocument').mockResolvedValue({ id: 'cloud_1', currentVersion: 12 } as never);
    // The cloud kept 11 and 12; 1..10 were trimmed. The local copy still has all.
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue(
      [11, 12].map(v => ({ id: `v${v}`, version: v })) as never,
    );
    vi.spyOn(LocalVersionService, 'getVersions').mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        id: `v${i + 1}`, version: i + 1, content: 'x', wordCount: 1,
        duration: 0, wpm: 0, savedAt: 1, sessionStartedAt: 1,
      })) as never,
    );
    const addVersion = vi.spyOn(VersionService, 'addVersion').mockResolvedValue(undefined as never);
    vi.spyOn(DocumentService, 'updateDocumentAfterSession').mockResolvedValue(undefined as never);

    await CloudSyncService.addCloudCopy('user_1', 'local_1');

    expect(addVersion).not.toHaveBeenCalled();
  });
});

// A run that ran out of write budget used to advance currentVersion anyway, set
// the link, clear the queue and log "Заметка сохранена в облако" — so a cloud
// copy missing half its history looked complete and stayed that way.
describe('addCloudCopy — a partial upload is not a success', () => {
  beforeEach(() => {
    vi.mocked(WriteBudget.areCloudWritesBlockedToday).mockReturnValue(false);
  });

  it('reports incomplete, keeps the link, and does not claim the missing version', async () => {
    // Budget for the document create and the first two versions only.
    vi.mocked(WriteBudget.tryReserveBulkWriteBudget)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValue(false);

    const { LocalVersionService } = await import('../LocalVersionService');
    const { VersionService } = await import('../VersionService');
    const { DocumentService } = await import('../DocumentService');

    vi.spyOn(LocalStorageService, 'getDocument').mockResolvedValue({
      id: 'local_1', currentVersion: 3, totalWords: 30, totalDuration: 0, sessionsCount: 3,
    } as never);
    vi.spyOn(LocalVersionService, 'getVersions').mockResolvedValue(
      [1, 2, 3].map(v => ({
        id: `v${v}`, version: v, content: `text ${v}`, wordCount: 1,
        duration: 0, wpm: 0, savedAt: 1, sessionStartedAt: 1,
      })) as never,
    );
    vi.spyOn(DocumentService, 'createDocument').mockResolvedValue('cloud_new');
    vi.spyOn(VersionService, 'addVersion').mockResolvedValue(undefined as never);
    const meta = vi.spyOn(DocumentService, 'updateDocumentAfterSession').mockResolvedValue(undefined as never);
    const link = vi.spyOn(LocalStorageService, 'updateLinkedCloudId').mockResolvedValue(undefined);
    vi.spyOn(LocalStorageService, 'migrateDocumentOwner').mockResolvedValue(undefined as never);

    const result = await CloudSyncService.addCloudCopy('user_1', 'local_1');

    // Empty id — every caller leaves the queue item in place and retries later.
    expect(result).toBe('');
    // The cloud document exists, so the link must be kept or a retry creates a second one.
    expect(link).toHaveBeenCalledWith('local_1', 'cloud_new');
    // And it must not advertise a version it never received.
    expect(meta).toHaveBeenCalledWith('user_1', 'cloud_new', expect.objectContaining({ currentVersion: 2 }));
  });
});
