import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncService } from '../SyncService';
import { DocumentService } from '../DocumentService';
import { LocalDocumentService } from '../LocalDocumentService';
import { StorageService } from '../StorageService';
import { CloudSyncService } from '../CloudSyncService';
import { useActivityLogStore } from '../../../shared/activity/useActivityLogStore';
import * as cryptoHelpers from '../../crypto/cryptoHelpers';
import * as encryptModule from '../../crypto/encrypt';

describe('SYNC-D1: downloadAllFromCloud', () => {
  const userId = 'user_d1_test';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(cryptoHelpers, 'getEncryptionEnabled').mockReturnValue(false);
    vi.spyOn(encryptModule, 'getSessionKey').mockReturnValue({} as CryptoKey);
    vi.spyOn(CloudSyncService, 'relinkOrphanedDocuments').mockResolvedValue({ relinked: 0, skippedIds: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('downloads notes that exist in cloud but not locally', async () => {
    const cloudDocs = [
      { id: 'cloud_1', title: 'Note 1', currentVersion: 1 },
      { id: 'cloud_2', title: 'Note 2', currentVersion: 2 },
    ] as any[];
    const localDocs = [] as any[];

    vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue(cloudDocs);
    vi.spyOn(LocalDocumentService, 'getDocumentsByOwner').mockResolvedValue(localDocs);
    const addLocalCopySpy = vi.spyOn(CloudSyncService, 'addLocalCopy').mockResolvedValue('local_new');
    const addCloudCopySpy = vi.spyOn(StorageService, 'addCloudCopy');
    const addActivitySpy = vi.spyOn(useActivityLogStore.getState(), 'addActivity');

    const result = await SyncService.downloadAllFromCloud(userId);

    expect(result).toEqual({ downloaded: 2, skipped: 0, failed: 0 });
    expect(addLocalCopySpy).toHaveBeenCalledTimes(2);
    expect(addLocalCopySpy).toHaveBeenCalledWith(userId, 'cloud_1');
    expect(addLocalCopySpy).toHaveBeenCalledWith(userId, 'cloud_2');
    // Task 3: verify it does NOT call addCloudCopy on download
    expect(addCloudCopySpy).not.toHaveBeenCalled();
    expect(addActivitySpy).toHaveBeenCalledWith(
      'Загружено заметок из облака: 2',
      expect.objectContaining({ action: 'downloadAllFromCloud', downloaded: 2 }),
      'info',
      'sync'
    );
  });

  it('skips notes that are already linked locally without re-downloading or re-uploading', async () => {
    const cloudDocs = [
      { id: 'cloud_1', title: 'Note 1' },
      { id: 'cloud_2', title: 'Note 2' },
    ] as any[];
    const localDocs = [
      { id: 'loc_1', linkedCloudId: 'cloud_1' },
    ] as any[];

    vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue(cloudDocs);
    vi.spyOn(LocalDocumentService, 'getDocumentsByOwner').mockResolvedValue(localDocs);
    const addLocalCopySpy = vi.spyOn(CloudSyncService, 'addLocalCopy').mockResolvedValue('loc_2');
    const addCloudCopySpy = vi.spyOn(StorageService, 'addCloudCopy');

    const result = await SyncService.downloadAllFromCloud(userId);

    expect(result).toEqual({ downloaded: 1, skipped: 1, failed: 0 });
    expect(addLocalCopySpy).toHaveBeenCalledTimes(1);
    expect(addLocalCopySpy).toHaveBeenCalledWith(userId, 'cloud_2');
    expect(addCloudCopySpy).not.toHaveBeenCalled();
  });

  it('skips download safely if vault encryption is enabled but vault is locked', async () => {
    vi.spyOn(cryptoHelpers, 'getEncryptionEnabled').mockReturnValue(true);
    vi.spyOn(encryptModule, 'getSessionKey').mockReturnValue(null);

    const getUserDocsSpy = vi.spyOn(DocumentService, 'getUserDocuments');
    const addLocalCopySpy = vi.spyOn(CloudSyncService, 'addLocalCopy');

    const result = await SyncService.downloadAllFromCloud(userId);

    expect(result).toEqual({ downloaded: 0, skipped: 0, failed: 0, locked: true });
    expect(getUserDocsSpy).not.toHaveBeenCalled();
    expect(addLocalCopySpy).not.toHaveBeenCalled();
  });

  it('skips notes whose uuid matches a local document to prevent duplicate download', async () => {
    const cloudDocs = [
      { id: 'cloud_uuid_1', uuid: 'canonical-uuid-1', title: 'Note' },
    ] as any[];
    const localDocs = [
      { id: 'loc_doc_1', uuid: 'canonical-uuid-1' },
    ] as any[];

    vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue(cloudDocs);
    vi.spyOn(LocalDocumentService, 'getDocumentsByOwner').mockResolvedValue(localDocs);
    const addLocalCopySpy = vi.spyOn(CloudSyncService, 'addLocalCopy');

    const result = await SyncService.downloadAllFromCloud(userId);

    expect(result).toEqual({ downloaded: 0, skipped: 1, failed: 0 });
    expect(addLocalCopySpy).not.toHaveBeenCalled();
  });

  it('S-1: coalesces concurrent calls into a single in-flight download per user', async () => {
    const cloudDocs = [{ id: 'cloud_1', title: 'Note 1' }] as any[];
    vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue(cloudDocs);
    vi.spyOn(LocalDocumentService, 'getDocumentsByOwner').mockResolvedValue([]);
    const addLocalCopySpy = vi.spyOn(CloudSyncService, 'addLocalCopy').mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 10));
      return 'local_1';
    });

    const [res1, res2] = await Promise.all([
      SyncService.downloadAllFromCloud(userId),
      SyncService.downloadAllFromCloud(userId),
    ]);

    expect(res1).toEqual({ downloaded: 1, skipped: 0, failed: 0 });
    expect(res2).toEqual({ downloaded: 1, skipped: 0, failed: 0 });
    expect(addLocalCopySpy).toHaveBeenCalledTimes(1);
  });

  it('S-2: propagates error when relinkOrphanedDocuments throws and halts download', async () => {
    vi.spyOn(CloudSyncService, 'relinkOrphanedDocuments').mockRejectedValue(new Error('Network error during relink'));
    const getUserDocsSpy = vi.spyOn(DocumentService, 'getUserDocuments');
    const addLocalCopySpy = vi.spyOn(CloudSyncService, 'addLocalCopy');

    await expect(SyncService.downloadAllFromCloud(userId)).rejects.toThrow('Network error during relink');
    expect(getUserDocsSpy).not.toHaveBeenCalled();
    expect(addLocalCopySpy).not.toHaveBeenCalled();
  });
});
