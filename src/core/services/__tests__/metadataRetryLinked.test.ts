import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { CloudSyncService } from '../CloudSyncService';
import { DocumentService } from '../DocumentService';
import { LocalStorageService } from '../LocalStorageService';
import { LocalDocumentService } from '../LocalDocumentService';
import { VersionService } from '../VersionService';
import { getLocalDb } from '../../storage/localDb';
import { setEncryptionEnabled, setProfileLoaded } from '../../crypto/cryptoHelpers';

// R3-1: правка «не показывать ИИ» (и названия, тегов, метки) у связанной
// заметки не дошла до облака. Раньше дренаж слал только счётчики и снимал
// задачу — правка терялась, и заметка на другом устройстве снова шла модели.
describe('R3-1: a failed metadata edit reaches the cloud on the retry', () => {
  const userId = 'user_meta_retry';

  beforeEach(async () => {
    vi.restoreAllMocks();
    setProfileLoaded(userId, true);
    setEncryptionEnabled(userId, false);
    const db = await getLocalDb(userId);
    for (const s of ['documents', 'versions', 'syncQueue'] as const) await db.clear(s);
  });

  it('pushes title, tags, label and excludedFromAI, then clears the flag', async () => {
    const docId = await LocalStorageService.createDocument(userId, { title: 'Новое название', tags: ['тег'] });
    await LocalStorageService.updateLinkedCloudId(docId, 'cloud_1', userId);
    await LocalDocumentService.updateExcludedFromAI(docId, true, userId);
    await LocalDocumentService.setMetadataDirty(docId, true, userId);

    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue({
      id: 'cloud_1', title: 'Старое', tags: [], currentVersion: 5, totalWords: 0, totalDuration: 0,
      sessionsCount: 0, firstSessionAt: null, lastSessionAt: null,
    } as never);
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([]);
    const meta = vi.spyOn(DocumentService, 'updateMetadata').mockResolvedValue(undefined);
    vi.spyOn(DocumentService, 'updateDocumentAfterSession').mockResolvedValue(undefined);

    await CloudSyncService.addCloudCopy(userId, docId);

    expect(meta).toHaveBeenCalledWith(userId, 'cloud_1', expect.objectContaining({
      title: 'Новое название', tags: ['тег'], excludedFromAI: true,
    }));
    expect((await LocalStorageService.getDocument(docId, userId))?.metadataDirty).toBeFalsy();
  });
});
