// EA-3: разрешение конфликта не должно терять локальные версии — ни при сбое
// копирования в форк, ни при сбое чтения облака, ни когда офлайн-правка
// совпадает номером с облачной версией.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

const getCloudVersions = vi.hoisted(() => vi.fn());
vi.mock('../VersionService', () => ({
  VersionService: {
    getVersions: (...a: unknown[]) => getCloudVersions(...a),
    addVersion: vi.fn().mockResolvedValue('ver_x'),
  },
}));

import { ConflictResolver } from '../ConflictResolver';
import { LocalVersionService } from '../LocalVersionService';
import { getLocalDb } from '../../storage/localDb';

const USER = 'user_fork_safety';
const cloudV = (version: number, content: string) => ({ version, content, wordCount: 1, duration: 0, wpm: 0, sessionStartedAt: 1000, savedAt: 1000 });

async function contentsOf(documentId: string): Promise<string[]> {
  return (await LocalVersionService.getVersions(documentId, USER)).map(v => v.content).sort();
}

async function forkId(): Promise<string> {
  const db = await getLocalDb(USER);
  return (await db.getAll('documents')).find(d => d.id !== 'local_orig')!.id;
}

const resolve = () => ConflictResolver.resolveConflict(
  USER, 'local_orig', 'cloud_orig',
  { title: 'T', content: 'D-new', wordCount: 1, duration: 0, wpm: 0, sessionStartedAt: new Date(1000) } as never,
  4, { currentVersion: 2 }, 1000,
);

beforeEach(async () => {
  vi.restoreAllMocks();
  getCloudVersions.mockReset();
  const db = await getLocalDb(USER);
  for (const store of ['documents', 'versions', 'syncQueue'] as const) {
    for (const rec of await db.getAll(store)) await db.delete(store, (rec as { id: string }).id);
  }
  await db.put('documents', {
    id: 'local_orig', guestId: USER, title: 'T', currentVersion: 3, totalWords: 3, totalDuration: 0,
    sessionsCount: 3, firstSessionAt: 1000, lastSessionAt: 2000, tags: [], linkedCloudId: 'cloud_orig',
  } as never);
  const v = (n: number, content: string) => ({
    id: `v${n}`, documentId: 'local_orig', guestId: USER, version: n, content, wordCount: 1,
    wordsAdded: 1, charsAdded: 1, duration: 0, wpm: 0, savedAt: 1000 + n, sessionStartedAt: 1000,
  });
  await db.put('versions', v(1, 'A') as never);
  await db.put('versions', v(2, 'B-offline') as never); // в облаке v2 другая
  await db.put('versions', v(3, 'C-offline') as never); // в облаке v3 нет
});

describe('conflict fork safety (EA-3)', () => {
  it('an offline edit that shares a version number with the cloud goes into the fork', async () => {
    getCloudVersions.mockResolvedValue([cloudV(1, 'A'), cloudV(2, 'B-cloud')]);
    await resolve();
    expect(await contentsOf(await forkId())).toEqual(['B-offline', 'C-offline', 'D-new']);
    expect(await contentsOf('local_orig')).toEqual(['A', 'B-cloud']);
  });

  it('leaves the original untouched when copying into the fork fails', async () => {
    getCloudVersions.mockResolvedValue([cloudV(1, 'A'), cloudV(2, 'B-cloud')]);
    const realAdd = LocalVersionService.addVersion.bind(LocalVersionService);
    vi.spyOn(LocalVersionService, 'addVersion').mockImplementation(async (uid, docId, data) => {
      if (docId !== 'local_orig' && data.versionNumber !== 1) throw new Error('quota exceeded');
      return realAdd(uid, docId, data);
    });
    await resolve();
    expect(await contentsOf('local_orig')).toEqual(['A', 'B-offline', 'C-offline']);
  });

  it('leaves the original untouched when the cloud versions cannot be read', async () => {
    getCloudVersions.mockRejectedValue(new Error('network'));
    await resolve();
    expect(await contentsOf('local_orig')).toEqual(['A', 'B-offline', 'C-offline']);
  });
});
