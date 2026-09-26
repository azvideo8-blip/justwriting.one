import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import { LocalStorageService } from '../LocalStorageService';
import { LocalDocumentService } from '../LocalDocumentService';
import { syncStatusOf } from '../../sync/syncStatus';

// D-5: после «Удалить облачную копию» заметка навечно оставалась «только на
// устройстве»: любая попытка отправить отказывала, а снять пометку в интерфейсе
// было нельзя (re-link по uuid не помогает — облачной копии больше нет).
const USER = 'user_d5';

async function newNote(tag: string) {
  const { localId } = await LocalStorageService.saveNew(USER, {
    title: `Заметка ${tag}`, content: `текст заметки ${tag}`, wordCount: 3, duration: 0, wpm: 0,
    tags: [], sessionStartedAt: new Date(),
  });
  return localId;
}

describe('clearLocalOnlyForUpload (D-5)', () => {
  beforeEach(async () => {
    const db = await getLocalDb(USER);
    for (const store of ['documents', 'versions'] as const) {
      for (const rec of await db.getAll(store)) await db.delete(store, (rec as { id: string }).id);
    }
  });

  it('lifts the mark after a deliberate unlink, so the note can go back to the cloud', async () => {
    const id = await newNote('a');
    await LocalDocumentService.unlinkFromCloud(id, 'user_choice', USER);
    expect((await LocalStorageService.getDocument(id, USER))?.localOnly).toBe(true);
    // Пока пометка стоит — фоновые проходы заметку не отправляют.
    expect(syncStatusOf((await LocalStorageService.getDocument(id, USER))!)).toBe('local-only');

    expect(await LocalDocumentService.clearLocalOnlyForUpload(id, USER)).toBe(true);

    const doc = await LocalStorageService.getDocument(id, USER);
    expect(doc?.localOnly).toBe(false);
    expect(syncStatusOf(doc!)).not.toBe('local-only');
  });

  it('keeps the tombstone mark: re-uploading such a note would resurrect a cloud deletion', async () => {
    const id = await newNote('b');
    await LocalDocumentService.unlinkFromCloud(id, 'tombstone', USER);

    expect(await LocalDocumentService.clearLocalOnlyForUpload(id, USER)).toBe(false);

    const doc = await LocalStorageService.getDocument(id, USER);
    expect(doc?.localOnly).toBe(true);
    expect(doc?.unlinkedByTombstone).toBe(true);
  });

  it('is a no-op for a note that was never marked, and for a missing one', async () => {
    const id = await newNote('c');
    expect(await LocalDocumentService.clearLocalOnlyForUpload(id, USER)).toBe(false);
    expect((await LocalStorageService.getDocument(id, USER))?.localOnly).toBeFalsy();

    expect(await LocalDocumentService.clearLocalOnlyForUpload('local_missing', USER)).toBe(false);
  });
});
