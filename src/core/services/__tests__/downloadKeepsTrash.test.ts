import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { CloudSyncService } from '../CloudSyncService';
import { DocumentService } from '../DocumentService';
import { VersionService } from '../VersionService';
import { LocalStorageService } from '../LocalStorageService';
import { getLocalDb } from '../../storage/localDb';
import { setEncryptionEnabled, setProfileLoaded } from '../../crypto/cryptoHelpers';

// R3-5: заметка из корзины скачивалась на второе устройство обычной — и снова
// попадала в ИИ-контекст. Пометка корзины должна приезжать вместе с ней.
describe('R3-5: a trashed cloud note arrives in the trash', () => {
  const userId = 'user_trash_dl';
  beforeEach(async () => {
    vi.restoreAllMocks();
    setProfileLoaded(userId, true);
    setEncryptionEnabled(userId, false);
    const db = await getLocalDb();
    for (const s of ['documents', 'versions'] as const) await db.clear(s);
  });

  it('keeps trashedAt on the local copy', async () => {
    const trashedAt = new Date('2026-09-20T10:00:00Z');
    vi.spyOn(DocumentService, 'getDocument').mockResolvedValue({
      id: 'cloud_t', uuid: 'uuid-t', title: 'В корзине', tags: [], currentVersion: 1, totalWords: 1,
      totalDuration: 0, sessionsCount: 1, firstSessionAt: null, lastSessionAt: null, trashedAt,
    } as never);
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([
      { version: 1, content: 'текст', wordCount: 1, duration: 0, wpm: 0, sessionStartedAt: trashedAt, savedAt: trashedAt },
    ] as never);

    const localId = await CloudSyncService.addLocalCopy(userId, 'cloud_t');
    const doc = await LocalStorageService.getDocument(localId);
    expect(doc?.trashedAt).toBe(trashedAt.getTime());
  });
});
