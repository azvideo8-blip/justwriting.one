import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { CloudSyncService } from '../CloudSyncService';
import { DocumentService } from '../DocumentService';
import { VersionService } from '../VersionService';
import { LocalStorageService } from '../LocalStorageService';
import { LocalVersionService } from '../LocalVersionService';
import * as CryptoHelpers from '../../crypto/cryptoHelpers';

// NB-9 (sus14): пропущенные битые версии молча терялись для вызывающего —
// «Скачать с облака» показывал успех, хотя история приехала неполной.
// Результат addLocalCopy обязан нести число пропущенных версий.
const CIPHERTEXT = 'k7Hs9x2fQ0aZ==';

const cloudVersion = (v: number) => ({
  id: `v${v}`, version: v, content: CIPHERTEXT, wordCount: 1,
  duration: 0, wpm: 0, savedAt: 1, sessionStartedAt: 1, _encrypted: true,
});

describe('sus14: addLocalCopy возвращает число пропущенных версий', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(LocalStorageService, 'getDocumentsByOwner').mockResolvedValue([]);
    vi.spyOn(LocalStorageService, 'createDocument').mockResolvedValue('local_new');
    vi.spyOn(LocalStorageService, 'updateDocument').mockResolvedValue(undefined as never);
    vi.spyOn(LocalStorageService, 'updateLinkedCloudId').mockResolvedValue(undefined);
    vi.spyOn(LocalStorageService, 'deleteDocument').mockResolvedValue(undefined as never);
    vi.spyOn(DocumentService, 'getDocument').mockResolvedValue({
      id: 'cloud_1', title: 'n', tags: [], totalWords: 1, totalDuration: 0,
      currentVersion: 2, sessionsCount: 1, firstSessionAt: new Date(1), lastSessionAt: new Date(2),
    } as never);
    vi.spyOn(LocalVersionService, 'addVersion').mockResolvedValue(undefined as never);
  });

  afterEach(() => vi.restoreAllMocks());

  it('битая старая версия пропущена → skippedVersions: 1, заметка скачана', async () => {
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([cloudVersion(1), cloudVersion(2)] as never);
    vi.spyOn(CryptoHelpers, 'maybeDecrypt').mockImplementation(async (doc) => {
      if ((doc as { version?: number }).version === 1) throw new CryptoHelpers.DecryptionError('content');
      return { ...(doc as object), content: 'настоящий текст' } as never;
    });

    const res = await CloudSyncService.addLocalCopy('user_1', 'cloud_1');

    expect(res).toEqual({ localId: 'local_new', skippedVersions: 1 });
  });

  it('контроль: обе версии читаются → skippedVersions: 0', async () => {
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([cloudVersion(1), cloudVersion(2)] as never);
    vi.spyOn(CryptoHelpers, 'maybeDecrypt').mockImplementation(async (doc) =>
      ({ ...(doc as object), content: 'текст' }) as never);

    const res = await CloudSyncService.addLocalCopy('user_1', 'cloud_1');

    expect(res).toEqual({ localId: 'local_new', skippedVersions: 0 });
  });

  it('уже связанная заметка: ранний возврат тоже несёт skippedVersions: 0', async () => {
    vi.spyOn(LocalStorageService, 'getDocumentsByOwner').mockResolvedValue([
      { id: 'local_existing', linkedCloudId: 'cloud_1' },
    ] as never);
    const getDoc = vi.spyOn(DocumentService, 'getDocument');

    const res = await CloudSyncService.addLocalCopy('user_1', 'cloud_1');

    expect(res).toEqual({ localId: 'local_existing', skippedVersions: 0 });
    expect(getDoc).not.toHaveBeenCalled();
  });
});