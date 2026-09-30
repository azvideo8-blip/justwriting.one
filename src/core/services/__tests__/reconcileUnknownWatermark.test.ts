import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';

/**
 * R3-010 — заметка, связанная старой версией приложения, не знает
 * lastSyncedCloudVersion. Сверка вела её в перемотку: счётчики вставали на
 * голову облака, а локальный текст, отличный от облачного, объявлялся
 * синхронизированным. Устройство показывало своё, облако — своё.
 */

vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { SyncService } from '../SyncService';
import { DocumentService } from '../DocumentService';
import { VersionService } from '../VersionService';
import { LocalVersionService } from '../LocalVersionService';
import { getLocalDb } from '../../storage/localDb';
import * as CryptoHelpers from '../../crypto/cryptoHelpers';
import * as encryptModule from '../../crypto/encrypt';
import { registerActiveEditorDocIdGetter } from '../../sync/activeEditor';

const USER = 'user_r3_010';
const LOCAL_ID = 'local_r3_010';
const CLOUD_ID = 'cloud_r3_010';

const cloudVersion = (v: number, content: string) => ({
  id: `cv_${v}`, version: v, content, wordCount: 2, duration: 10, wpm: 30, savedAt: 1, sessionStartedAt: 1,
});

async function seed(localV2: string) {
  const db = await getLocalDb(USER);
  await db.clear('documents');
  await db.clear('versions');
  await db.clear('syncQueue');
  await db.put('documents', {
    id: LOCAL_ID, guestId: USER, title: 'Note', currentVersion: 2, totalWords: 2,
    totalDuration: 10, sessionsCount: 2, firstSessionAt: 1000, lastSessionAt: 1000,
    tags: [], linkedCloudId: CLOUD_ID,
  } as never);
  for (const [v, content] of [[1, 'общий текст'], [2, localV2]] as const) {
    await db.put('versions', {
      id: `ver_loc_${v}`, documentId: LOCAL_ID, guestId: USER, version: v,
      content, wordCount: 2, duration: 10, wpm: 30, savedAt: 1000, sessionStartedAt: 1000,
    } as never);
  }
}

describe('R3-010: reconcile without a sync watermark', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(CryptoHelpers, 'getEncryptionEnabled').mockReturnValue(false);
    vi.spyOn(encryptModule, 'getSessionKey').mockReturnValue({} as CryptoKey);
    registerActiveEditorDocIdGetter(() => null);
    vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([{
      id: CLOUD_ID, title: 'Note', currentVersion: 2, totalWords: 2, totalDuration: 20,
      sessionsCount: 2, tags: [],
      updatedAt: new Date('2026-09-19T12:00:00.000Z'),
      createdAt: new Date('2026-09-19T09:00:00.000Z'),
    } as never]);
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue(
      [cloudVersion(1, 'общий текст'), cloudVersion(2, 'облачная правка')] as never,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('другой текст локально: облачная голова ложится сверху, локальная правка остаётся в истории', async () => {
    await seed('локальная правка');
    await SyncService.reconcileLinkedDocuments(USER);

    expect(await LocalVersionService.getLatestContent(LOCAL_ID, USER)).toBe('облачная правка');
    const contents = (await LocalVersionService.getVersions(LOCAL_ID, USER)).map(v => v.content);
    expect(contents).toContain('локальная правка');
  });

  it('тот же текст локально: перемотка ставит отметку и ничего не дублирует', async () => {
    await seed('облачная правка');
    await SyncService.reconcileLinkedDocuments(USER);

    const db = await getLocalDb(USER);
    expect((await db.get('documents', LOCAL_ID))?.lastSyncedCloudVersion).toBe(2);
    expect(await LocalVersionService.getVersions(LOCAL_ID, USER)).toHaveLength(2);
  });
});
