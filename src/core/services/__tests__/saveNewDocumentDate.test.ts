import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../core/storage/localDb';
import { LocalStorageService } from '../../../core/services/LocalStorageService';

const USER = 'user_import_date';

async function clear() {
  const db = await getLocalDb(USER);
  for (const store of ['documents', 'versions'] as const) {
    for (const rec of await db.getAll(store)) await db.delete(store, (rec as { id: string }).id);
  }
}

// D-4: импорт старого дневника раскладывал весь архив на сегодняшний день,
// потому что дата файла доходила только до версии, а заметка в списке,
// календаре и «в этот день» берётся из firstSessionAt/lastSessionAt документа.
describe('saveNew honours documentDate (D-4)', () => {
  beforeEach(clear);

  it('dates the note by the file date, not by the import moment', async () => {
    const fileDate = new Date('2025-03-01T18:30:00');
    const { localId } = await LocalStorageService.saveNew(USER, {
      title: 'Старая запись', content: 'текст из файла', wordCount: 3, duration: 0, wpm: 0,
      tags: [], sessionStartedAt: fileDate, documentDate: fileDate,
    });

    const db = await getLocalDb(USER);
    const doc = await db.get('documents', localId);
    const version = (await db.getAll('versions'))[0];

    expect(doc?.firstSessionAt).toBe(fileDate.getTime());
    expect(doc?.lastSessionAt).toBe(fileDate.getTime());
    // Стрик и активность считаются по savedAt подхода (utils#getSessionDates).
    expect(version?.savedAt).toBe(fileDate.getTime());
  });

  it('keeps dating a normal first save by the save moment', async () => {
    const before = Date.now();
    const { localId } = await LocalStorageService.saveNew(USER, {
      title: 'Свежая запись', content: 'написано сейчас', wordCount: 2, duration: 0, wpm: 0,
      tags: [], sessionStartedAt: new Date(before - 20 * 60 * 1000),
    });
    const after = Date.now();

    const db = await getLocalDb(USER);
    const doc = await db.get('documents', localId);
    const version = (await db.getAll('versions'))[0];

    expect(doc?.lastSessionAt).toBeGreaterThanOrEqual(before);
    expect(doc?.lastSessionAt).toBeLessThanOrEqual(after);
    expect(version?.savedAt).toBeGreaterThanOrEqual(before);
    // Подход сам по себе датируется началом сессии — как и раньше.
    expect(version?.sessionStartedAt).toBe(before - 20 * 60 * 1000);
  });
});
