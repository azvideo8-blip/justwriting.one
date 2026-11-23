import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { CloudSyncService } from '../CloudSyncService';
import { DocumentService } from '../DocumentService';
import { LocalStorageService } from '../LocalStorageService';


describe('CloudSyncService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('restoreMissingDocuments', () => {


    it('returns hasMore false when all documents restored successfully', async () => {

      vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([
        { id: 'cloud_1' } as any,
        { id: 'cloud_2' } as any,
      ]);
      vi.spyOn(LocalStorageService, 'getDocumentsByOwner').mockResolvedValue([]);
      const addLocalCopySpy = vi.spyOn(CloudSyncService, 'addLocalCopy').mockResolvedValue({ localId: 'local_1', skippedVersions: 0 });

      const result = await CloudSyncService.restoreMissingDocuments('user_1');
      expect(result).toEqual({ restored: 2, failed: 0, hasMore: false });
      expect(addLocalCopySpy).toHaveBeenCalledTimes(2);
    });

    it('re-links an unlinked local note instead of downloading a second copy', async () => {

      vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([
        { id: 'cloud_1', firstSessionAt: new Date(1000), lastSessionAt: new Date(2000) } as any,
      ]);
      vi.spyOn(LocalStorageService, 'getDocumentsByOwner').mockResolvedValue([
        { id: 'local_1', guestId: 'user_1', firstSessionAt: 1000 } as any,
      ]);
      const updateLink = vi.spyOn(LocalStorageService, 'updateLinkedCloudId').mockResolvedValue(undefined);
      const addLocalCopySpy = vi.spyOn(CloudSyncService, 'addLocalCopy').mockResolvedValue({ localId: 'local_9', skippedVersions: 0 });

      const result = await CloudSyncService.restoreMissingDocuments('user_1');

      expect(updateLink).toHaveBeenCalledWith('local_1', 'cloud_1', 'user_1');
      expect(addLocalCopySpy).not.toHaveBeenCalled();
      expect(result).toEqual({ restored: 0, failed: 0, hasMore: false });
    });
  });

  describe('relinkOrphanedDocuments', () => {
    const cloudDoc = (id: string, startMs: number) =>
      ({ id, firstSessionAt: new Date(startMs), lastSessionAt: new Date(startMs) }) as any;

    it('does not read the cloud when there is nothing to re-link', async () => {
      vi.spyOn(LocalStorageService, 'getDocumentsByOwner').mockResolvedValue([
        { id: 'local_1', guestId: 'user_1', firstSessionAt: 1000, linkedCloudId: 'cloud_1' } as any,
      ]);
      const cloudRead = vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([]);

      expect((await CloudSyncService.relinkOrphanedDocuments('user_1')).relinked).toBe(0);
      expect(cloudRead).not.toHaveBeenCalled();
    });

    it('leaves a deliberately unlinked note alone', async () => {
      vi.spyOn(LocalStorageService, 'getDocumentsByOwner').mockResolvedValue([
        { id: 'local_1', guestId: 'user_1', firstSessionAt: 1000, localOnly: true } as any,
      ]);
      const cloudRead = vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([]);

      expect((await CloudSyncService.relinkOrphanedDocuments('user_1')).relinked).toBe(0);
      expect(cloudRead).not.toHaveBeenCalled();
    });

    // AUDIT-L11 (доводка): заголовок — совещательный сигнал, а не обязательный.
    // Обязательным он создаёт вторую копию в облаке там, где раньше была
    // перелинковка: при закрытом сейфе заголовок облачной заметки не
    // расшифрован, при переименовании на одном устройстве — расходится.
    // Фальсификация: вернуть безусловное сравнение — три теста ниже краснеют.
    it('re-links when the cloud title is unreadable (locked vault)', async () => {
      vi.spyOn(LocalStorageService, 'getDocumentsByOwner').mockResolvedValue([
        { id: 'local_1', guestId: 'user_1', firstSessionAt: 1000, title: 'Про осень' } as never,
      ]);
      vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([
        { ...cloudDoc('cloud_1', 1000), title: 'U2FsdGVkX1+abc', _locked: true } as never,
      ]);
      const updateLink = vi.spyOn(LocalStorageService, 'updateLinkedCloudId').mockResolvedValue(undefined);

      expect((await CloudSyncService.relinkOrphanedDocuments('user_1')).relinked).toBe(1);
      expect(updateLink).toHaveBeenCalledWith('local_1', 'cloud_1', 'user_1');
    });

    it('re-links when one side has no title at all', async () => {
      vi.spyOn(LocalStorageService, 'getDocumentsByOwner').mockResolvedValue([
        { id: 'local_1', guestId: 'user_1', firstSessionAt: 1000, title: '' } as never,
      ]);
      vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([
        { ...cloudDoc('cloud_1', 1000), title: 'Про осень' } as never,
      ]);
      const updateLink = vi.spyOn(LocalStorageService, 'updateLinkedCloudId').mockResolvedValue(undefined);

      expect((await CloudSyncService.relinkOrphanedDocuments('user_1')).relinked).toBe(1);
      expect(updateLink).toHaveBeenCalledWith('local_1', 'cloud_1', 'user_1');
    });

    it('refuses when two readable titles genuinely disagree', async () => {
      vi.spyOn(LocalStorageService, 'getDocumentsByOwner').mockResolvedValue([
        { id: 'local_1', guestId: 'user_1', firstSessionAt: 1000, title: 'Про осень' } as never,
      ]);
      vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([
        { ...cloudDoc('cloud_1', 1000), title: 'Совсем другая заметка' } as never,
      ]);
      const updateLink = vi.spyOn(LocalStorageService, 'updateLinkedCloudId').mockResolvedValue(undefined);

      expect((await CloudSyncService.relinkOrphanedDocuments('user_1')).relinked).toBe(0);
      expect(updateLink).not.toHaveBeenCalled();
    });

    it('skips ambiguous matches rather than guessing', async () => {
      vi.spyOn(LocalStorageService, 'getDocumentsByOwner').mockResolvedValue([
        { id: 'local_1', guestId: 'user_1', firstSessionAt: 1000 } as any,
        { id: 'local_2', guestId: 'user_1', firstSessionAt: 1000 } as any,
        { id: 'local_3', guestId: 'user_1', firstSessionAt: 3000 } as any,
      ]);
      vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([
        cloudDoc('cloud_1', 1000),
        cloudDoc('cloud_2', 1000),
        cloudDoc('cloud_3', 3000),
      ]);
      const updateLink = vi.spyOn(LocalStorageService, 'updateLinkedCloudId').mockResolvedValue(undefined);

      expect((await CloudSyncService.relinkOrphanedDocuments('user_1')).relinked).toBe(1);
      expect(updateLink).toHaveBeenCalledTimes(1);
      expect(updateLink).toHaveBeenCalledWith('local_3', 'cloud_3', 'user_1');
    });

    it('never hands a cloud copy to two local notes', async () => {
      vi.spyOn(LocalStorageService, 'getDocumentsByOwner').mockResolvedValue([
        { id: 'local_1', guestId: 'user_1', firstSessionAt: 1000, linkedCloudId: 'cloud_1' } as any,
        { id: 'local_2', guestId: 'user_1', firstSessionAt: 1000 } as any,
      ]);
      vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([cloudDoc('cloud_1', 1000)]);
      const updateLink = vi.spyOn(LocalStorageService, 'updateLinkedCloudId').mockResolvedValue(undefined);

      expect((await CloudSyncService.relinkOrphanedDocuments('user_1')).relinked).toBe(0);
      expect(updateLink).not.toHaveBeenCalled();
    });

    it('propagates a failed cloud read instead of reporting "nothing matched"', async () => {
      vi.spyOn(LocalStorageService, 'getDocumentsByOwner').mockResolvedValue([
        { id: 'local_1', guestId: 'user_1', firstSessionAt: 1000 } as any,
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

    const { LocalVersionService } = await import('../LocalVersionService');
    const { VersionService } = await import('../VersionService');
    const { DocumentService } = await import('../DocumentService');

    vi.spyOn(LocalStorageService, 'getDocument').mockResolvedValue({
      id: 'local_1', linkedCloudId: 'cloud_1', currentVersion: 12,
      totalWords: 10, totalDuration: 0, sessionsCount: 1,
    } as never);
    vi.spyOn(DocumentService, 'getDocument').mockResolvedValue({ id: 'cloud_1', currentVersion: 12 } as never);
    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue({ id: 'cloud_1', currentVersion: 12 } as never);
    // The cloud kept 11 and 12; 1..10 were trimmed. The local copy still has all.
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue(
      [11, 12].map(v => ({ id: `v${v}`, version: v, content: 'x' })) as never,
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

  it('F-022: reports error when marking synced document fails in addCloudCopy', async () => {
    const { LocalVersionService } = await import('../LocalVersionService');
    const { VersionService } = await import('../VersionService');
    const { DocumentService } = await import('../DocumentService');
    const { getLocalDb } = await import('../../storage/localDb');
    const reportErrorModule = await import('../../../shared/errors/reportError');
    const reportErrorSpy = vi.spyOn(reportErrorModule, 'reportError');

    vi.spyOn(LocalStorageService, 'getDocument').mockResolvedValue({
      id: 'local_fail_mark', linkedCloudId: 'cloud_1', currentVersion: 1,
      totalWords: 10, totalDuration: 0, sessionsCount: 1,
    } as never);
    vi.spyOn(DocumentService, 'getDocument').mockResolvedValue({ id: 'cloud_1', currentVersion: 1 } as never);
    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue({ id: 'cloud_1', currentVersion: 1 } as never);
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([{ id: 'v1', version: 1, content: 'x' }] as never);
    vi.spyOn(LocalVersionService, 'getVersions').mockResolvedValue([{ id: 'v1', version: 1, content: 'x' }] as never);

    const db = await getLocalDb('user_1');
    const originalTransaction = db.transaction.bind(db);
    vi.spyOn(db, 'transaction').mockImplementation(((storeName: any, mode: any) => {
      if (storeName === 'documents' && mode === 'readwrite') {
        throw new Error('IDB write failure');
      }
      return originalTransaction(storeName, mode);
    }) as any);

    await CloudSyncService.addCloudCopy('user_1', 'local_fail_mark');

    expect(reportErrorSpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'addCloudCopy_markSynced', documentId: 'local_fail_mark' }),
      // S0-4: обе точки простановки отметки теперь отчитываются одним уровнем —
      // предупреждением, как это уже делала ветка создания (ряд в облаке есть,
      // не записалась только отметка «до какой версии»).
      'warning',
    );
  });
});

