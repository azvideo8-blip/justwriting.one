// AUDIT-MH3/MH5: форк конфликта несёт ВСЕ несинхронизированные версии,
// различимый заголовок, и создаётся ОДИН на документ за sync.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

const addVersionSpy = vi.hoisted(() => vi.fn().mockResolvedValue('ver_x'));
vi.mock('../VersionService', () => ({
  VersionService: {
    getVersions: vi.fn(),
    addVersion: (...a: unknown[]) => addVersionSpy(...(a as [])),
  },
}));

import { ConflictResolver } from '../ConflictResolver';
import { LocalVersionService } from '../LocalVersionService';
import { getLocalDb } from '../../storage/localDb';

const USER = 'user_fork';

async function seedOriginal() {
  const db = await getLocalDb();
  await db.put('documents', {
    id: 'local_orig', guestId: USER, title: 'Заметка про осень', currentVersion: 3,
    totalWords: 10, totalDuration: 0, sessionsCount: 1,
    firstSessionAt: 1000, lastSessionAt: 2000, tags: [], linkedCloudId: 'cloud_orig',
  } as never);
}

beforeEach(async () => {
  vi.restoreAllMocks();
  const db = await getLocalDb();
  for (const rec of await db.getAll('documents')) await db.delete('documents', (rec as { id: string }).id);
  for (const rec of await db.getAll('versions')) await db.delete('versions', (rec as { id: string }).id);
  for (const rec of await db.getAll('syncQueue')) await db.delete('syncQueue', (rec as { id: string }).id);
  await seedOriginal();
});

describe('AUDIT-MH3 fork contents and title', () => {
  it('fork title carries time + content preview', async () => {
    vi.spyOn(LocalVersionService, 'getVersions').mockResolvedValue([]);
    await ConflictResolver.resolveConflict(
      USER, 'local_orig', 'cloud_orig',
      { title: 'Заметка про осень', content: 'Листопад кружит над городом тихо и медленно', wordCount: 8, duration: 60, wpm: 8, sessionStartedAt: new Date(1000) } as never,
      4, { currentVersion: 3 }, 1000,
    );
    // Заголовок форка пишется через createDocument — проверяем локальную базу.
    const db = await getLocalDb();
    const docs = (await db.getAll('documents')).filter(d => d.id !== 'local_orig');
    expect(docs).toHaveLength(1);
    expect(docs[0]!.title).toMatch(/\((конфликт|conflict), .*\d{1,2}:\d{2}/);
    expect(docs[0]!.title).toContain('Листопад кружит');
  });

  it('unsynced local versions are copied into the fork', async () => {
    // Локальные версии 5 и 6 отсутствуют в облаке (облако знает 1..3).
    vi.spyOn(LocalVersionService, 'getVersions').mockImplementation(async (docId: string) => {
      if (docId === 'local_orig') return [
        { id: 'v3', version: 3, content: 'cloud three', wordCount: 3, duration: 1, wpm: 1, sessionStartedAt: 1000, savedAt: 1000, guestId: USER, documentId: docId },
        { id: 'v5', version: 5, content: 'unsynced five', wordCount: 2, duration: 1, wpm: 1, sessionStartedAt: 1500, savedAt: 1500 },
        { id: 'v6', version: 6, content: 'unsynced six', wordCount: 2, duration: 1, wpm: 1, sessionStartedAt: 1600, savedAt: 1600 },
      ] as never;
      return [];
    });
    const { VersionService } = await import('../VersionService');
    vi.mocked(VersionService.getVersions).mockResolvedValue([
      { version: 1 }, { version: 2 }, { version: 3 },
    ] as never);

    const localAddSpy = vi.spyOn(LocalVersionService, 'addVersion');
    await ConflictResolver.resolveConflict(
      USER, 'local_orig', 'cloud_orig',
      { title: 't', content: 'unsynced six', wordCount: 2, duration: 1, wpm: 1, sessionStartedAt: new Date(1600) } as never,
      6, { currentVersion: 3 }, 1000,
    );

    // Версия 3 уже в облаке — не копируется; 5 и 6 — копируются с сохранением номеров.
    const numbers = [addVersionSpy.mock.calls, localAddSpy.mock.calls]
      .flatMap(calls => calls.map((c: unknown[]) => (c[2] as { versionNumber?: number })?.versionNumber));
    expect(numbers).toContain(1);   // основная правка коллизии
    expect(numbers).toContain(5);   // несинхронизированная версия скопирована
    // v6 === контент коллизии — уже лежит в форке как версия 1, дубликата нет.
    expect(numbers.filter(n => n === 6)).toHaveLength(0);
    expect(numbers).not.toContain(3); // облачная версия не копируется
  });
});
