import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';

/**
 * A-4 (R2-004) — непрочитанную облачную версию нельзя объявлять синхронизированной.
 *
 * В ветке сверки `reconcileLinkedDocuments` облачная версия, которая не
 * расшифровалась, молча проходила мимо локальной истории, после чего заметке
 * поднимали `lastSyncedCloudVersion` и `currentVersion` до облачных. Итог:
 * «синхронизировано», дыра в истории, и ни одной записи о причине.
 *
 * Чиним ровно это: такие версии считаются и называются вслух (reportError +
 * запись в журнал), счётчик уходит наружу. Заметку при этом НЕ помечаем
 * `_decryptionError` — этот флаг значит «вся заметка нечитаема», и из-за одной
 * битой старой версии он убрал бы живую заметку из синхронизации навсегда.
 */

const CIPHERTEXT = 'k7Hs9x2fQ0aZ==';

vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { SyncService } from '../SyncService';
import { DocumentService } from '../DocumentService';
import { VersionService } from '../VersionService';
import { LocalVersionService } from '../LocalVersionService';
import { getLocalDb } from '../../storage/localDb';
import { useActivityLogStore } from '../../../shared/activity/useActivityLogStore';
import { reportError } from '../../../shared/errors/reportError';
import * as CryptoHelpers from '../../crypto/cryptoHelpers';
import * as encryptModule from '../../crypto/encrypt';
import { registerActiveEditorDocIdGetter } from '../../sync/activeEditor';

const USER = 'user_a4_corrupt';
const LOCAL_ID = 'local_a4';
const CLOUD_ID = 'cloud_a4';

const cloudVersion = (v: number) => ({
  id: `cv_${v}`, version: v, content: CIPHERTEXT, wordCount: 5,
  duration: 10, wpm: 30, savedAt: 1, sessionStartedAt: 1, _encrypted: true,
});

describe('A-4: reconcile reports unreadable cloud versions', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(CryptoHelpers, 'getEncryptionEnabled').mockReturnValue(false);
    vi.spyOn(encryptModule, 'getSessionKey').mockReturnValue({} as CryptoKey);
    registerActiveEditorDocIdGetter(() => null);

    const db = await getLocalDb(USER);
    await db.clear('documents');
    await db.clear('versions');
    await db.clear('syncQueue');

    // Заметка синхронизирована на v1, локальных правок нет, в редакторе не
    // открыта → именно ветка сверки, а не «облако новее, есть что отправить».
    await db.put('documents', {
      id: LOCAL_ID, guestId: USER, title: 'Note', currentVersion: 1, totalWords: 5,
      totalDuration: 10, sessionsCount: 1, firstSessionAt: 1000, lastSessionAt: 1000,
      tags: [], linkedCloudId: CLOUD_ID, lastSyncedCloudVersion: 1,
      lastSeenCloudUpdatedAt: '2026-09-19T10:00:00.000Z',
    } as never);
    await db.put('versions', {
      id: 'ver_loc_1', documentId: LOCAL_ID, guestId: USER, version: 1,
      content: 'первая версия', wordCount: 5, duration: 10, wpm: 30,
      savedAt: 1000, sessionStartedAt: 1000,
    } as never);

    vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([{
      id: CLOUD_ID, title: 'Note', currentVersion: 2, totalWords: 9, totalDuration: 20,
      sessionsCount: 2, tags: [],
      updatedAt: new Date('2026-09-19T12:00:00.000Z'),
      createdAt: new Date('2026-09-19T09:00:00.000Z'),
    } as never]);
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([cloudVersion(1), cloudVersion(2)] as never);
    vi.spyOn(LocalVersionService, 'addVersion');
  });

  afterEach(() => vi.restoreAllMocks());

  it('counts the unreadable version, says it out loud, and keeps the note readable', async () => {
    vi.spyOn(CryptoHelpers, 'maybeDecrypt').mockImplementation(async (doc) => {
      if ((doc as { version?: number }).version === 2) throw new CryptoHelpers.DecryptionError('content');
      return { ...(doc as object), content: 'первая версия' } as never;
    });
    const addActivity = vi.spyOn(useActivityLogStore.getState(), 'addActivity');

    const res = await SyncService.reconcileLinkedDocuments(USER);

    expect(res).toEqual({ reconciled: 1, skipped: 0, failed: 0, corrupted: 1 });
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        action: 'reconcileLinkedDocuments_corruptedVersions',
        documentId: LOCAL_ID,
        cloudDocumentId: CLOUD_ID,
        versions: '2',
      }),
      'warning',
    );
    expect(addActivity).toHaveBeenCalledWith(
      'activity_cloud_corrupted_versions',
      expect.objectContaining({ count: 1 }),
      'warning',
      'sync',
    );

    const db = await getLocalDb(USER);
    const doc = await db.get('documents', LOCAL_ID);
    expect(doc?.lastSyncedCloudVersion, 'метка синхронизации поднимается — иначе версия не прочитается никогда').toBe(2);
    expect(doc?._decryptionError, 'одна битая версия — не «вся заметка нечитаема»').toBeFalsy();
    const versions = await db.getAll('versions');
    expect(versions.map(v => v.version).sort()).toEqual([1]);
  });

  it('says nothing when every cloud version reads fine', async () => {
    vi.spyOn(CryptoHelpers, 'maybeDecrypt').mockImplementation(async (doc) => ({
      ...(doc as object), content: 'читаемый текст'
    } as never));

    const res = await SyncService.reconcileLinkedDocuments(USER);

    expect(res.corrupted).toBe(0);
    expect(reportError).not.toHaveBeenCalled();
  });
});
