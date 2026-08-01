import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import { LocalStorageService } from '../LocalStorageService';

const USER = 'user_atomic';

async function clear() {
  const db = await getLocalDb();
  for (const store of ['documents', 'versions'] as const) {
    for (const rec of await db.getAll(store)) await db.delete(store, (rec as { id: string }).id);
  }
}

// Three separate writes could leave a note with no versions, or a note whose
// counters claim it is empty while the text exists.
describe('saveNew is atomic', () => {
  beforeEach(clear);

  it('writes the document and its first version together, with counters set', async () => {
    const { localId } = await LocalStorageService.saveNew(USER, {
      title: 'Заголовок', content: 'первый текст', wordCount: 2, duration: 60, wpm: 2,
      tags: ['тег'], sessionStartedAt: new Date(1000),
    } as never);

    const db = await getLocalDb();
    const doc = await db.get('documents', localId);
    const versions = await db.getAllFromIndex('versions', 'by-document', localId);

    expect(versions).toHaveLength(1);
    expect(versions[0]!.content).toBe('первый текст');
    // The counters must not say "empty note" while the text is right there.
    expect(doc!.currentVersion).toBe(1);
    expect(doc!.totalWords).toBe(2);
    expect(doc!.sessionsCount).toBe(1);
    expect(doc!.title).toBe('Заголовок');
    expect(doc!.tags).toEqual(['тег']);
  });

  it('leaves nothing behind when the write fails', async () => {
    const db = await getLocalDb();
    const before = (await db.getAll('documents')).length;

    await expect(
      LocalStorageService.saveNew(USER, { title: 'x', content: 'y' } as never),
    ).rejects.toBeTruthy();

    expect((await db.getAll('documents')).length).toBe(before);
    expect((await db.getAll('versions')).length).toBe(0);
  });
});
