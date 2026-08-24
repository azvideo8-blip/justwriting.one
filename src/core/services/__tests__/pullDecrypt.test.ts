import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { CloudSyncService } from '../CloudSyncService';
import { DocumentService } from '../DocumentService';
import { VersionService } from '../VersionService';
import { LocalStorageService } from '../LocalStorageService';
import { LocalVersionService } from '../LocalVersionService';
import * as CryptoHelpers from '../../crypto/cryptoHelpers';

const CIPHERTEXT = 'k7Hs9x2fQ0aZ==';

const cloudVersion = (v: number, content = CIPHERTEXT) => ({
  id: `v${v}`, version: v, content, wordCount: 3,
  duration: 0, wpm: 0, savedAt: 1000 + v, sessionStartedAt: 900 + v, _encrypted: true,
});

// AUD-1: три pull-сайта (addCloudCopy, syncVersionToCloud, ConflictResolver)
// писали cv.content как есть. getVersions не расшифровывает, поэтому при
// включённом E2E в локальный стор ложился Base64.
describe('pull облачных версий в локальный стор (AUD-1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(LocalStorageService, 'getGuestDocuments').mockResolvedValue([
      { id: 'local_1', guestId: 'user_1', linkedCloudId: 'cloud_1' } as never,
    ]);
    vi.spyOn(LocalStorageService, 'getDocument').mockResolvedValue({
      id: 'local_1', guestId: 'user_1', title: 'n', tags: [], totalWords: 3, totalDuration: 0,
      currentVersion: 2, sessionsCount: 2, firstSessionAt: 1, lastSessionAt: 2,
      linkedCloudId: 'cloud_1',
    } as never);
    vi.spyOn(LocalVersionService, 'getVersions').mockResolvedValue([
      { id: 'a', documentId: 'local_1', version: 1, content: 'локальный текст v1' } as never,
    ]);
    // Обе стороны уже связаны: удалённого нет, замка нет.
    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue({
      id: 'cloud_1', title: 'n', tags: [], totalWords: 3, totalDuration: 0,
      currentVersion: 2, sessionsCount: 2, firstSessionAt: new Date(1), lastSessionAt: new Date(2),
    } as never);
    vi.spyOn(LocalVersionService, 'addVersion').mockResolvedValue('ver_new');
    vi.spyOn(LocalStorageService, 'updateAfterSession').mockResolvedValue(undefined as never);
    vi.spyOn(LocalStorageService, 'createDocument').mockResolvedValue('local_fork');
    // Push-путь не тестируем здесь — гасим сетевые записи.
    vi.spyOn(VersionService, 'addVersion').mockResolvedValue('cloud_ver');
    vi.spyOn(DocumentService, 'updateDocumentAfterSession').mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  /** maybeDecrypt: v2 расшифровывается, остальное — мусор. */
  function mockDecrypt() {
    return vi.spyOn(CryptoHelpers, 'maybeDecrypt').mockImplementation(async (doc) => {
      if ((doc as { version?: number }).version === 2) {
        return { ...(doc as object), content: 'облачный текст v2' } as never;
      }
      throw new CryptoHelpers.DecryptionError('content');
    });
  }

  it('addCloudCopy: читаемая версия пишется plaintext-ом, нечитаемая (v3) — не пишется вовсе', async () => {
    mockDecrypt();
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([
      cloudVersion(1), cloudVersion(2), cloudVersion(3),
    ] as never);

    await CloudSyncService.addCloudCopy('user_1', 'local_1');

    const written = (LocalVersionService.addVersion as ReturnType<typeof vi.fn>)
      .mock.calls.map(c => c[2] as { content: string; versionNumber: number });
    expect(written.some(w => w.versionNumber === 3))
      .toBe(false);
    expect(written.some(w => w.versionNumber === 2 && w.content === 'облачный текст v2'))
      .toBe(true);
    expect(written.some(w => w.content === CIPHERTEXT))
      .toBe(false);
  });

  it('syncVersionToCloud: нечитаемая облачная версия не попадает в локальный стор', async () => {
    mockDecrypt();
    // v3 нечитаемая, новая правка v5 выше облачного потолка — без конфликта.
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([cloudVersion(3)] as never);

    await CloudSyncService.syncVersionToCloud(
      'user_1', 'local_1', 'cloud_1',
      { content: 'новая правка', title: 'n', tags: [], wordCount: 5, duration: 10, wpm: 30, sessionStartedAt: new Date(), documentWordCount: 8 },
      5,
      'база',
    );

    const written = (LocalVersionService.addVersion as ReturnType<typeof vi.fn>)
      .mock.calls.map(c => c[2] as { content: string; versionNumber: number });
    expect(written.filter(w => w.versionNumber === 3)).toHaveLength(0);
    expect(written.every(w => w.content !== CIPHERTEXT)).toBe(true);
  });

  it('addCloudCopy: LOCKED прерывает загрузку вместо тихого пропуска версий', async () => {
    vi.spyOn(CryptoHelpers, 'maybeDecrypt').mockRejectedValue(new Error('LOCKED: session key not available'));
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([cloudVersion(3)] as never);

    await expect(
      CloudSyncService.addCloudCopy('user_1', 'local_1'),
    ).rejects.toThrow(/LOCKED/);
    expect((LocalVersionService.addVersion as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
