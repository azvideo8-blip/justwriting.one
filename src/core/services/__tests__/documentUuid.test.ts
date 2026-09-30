import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import { LocalStorageService } from '../LocalStorageService';
import { LocalDocumentService } from '../LocalDocumentService';

async function clear() {
  const db = await getLocalDb('u1');
  for (const rec of await db.getAll('documents')) await db.delete('documents', (rec as { id: string }).id);
}

// Локальный id и linkedCloudId — адреса в двух хранилищах, а не имя заметки.
// Пока общего имени не было, производные ИИ находили свою заметку сшивкой по
// хешу содержимого, и две заметки с одинаковым текстом отбирали сводку друг у друга.
describe('a note gets a canonical uuid', () => {
  beforeEach(clear);

  it('assigns one on first save', async () => {
    const { localId } = await LocalStorageService.saveNew('u1', {
      title: 'n', content: 'текст', wordCount: 1, duration: 0, wpm: 0,
      tags: [], sessionStartedAt: new Date(1000),
    } as never);

    const db = await getLocalDb('u1');
    expect((await db.get('documents', localId))!.uuid).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('gives two notes different uuids', async () => {
    const a = await LocalStorageService.saveNew('u1', {
      title: 'n', content: 'одинаковый текст', wordCount: 2, duration: 0, wpm: 0,
      tags: [], sessionStartedAt: new Date(1000),
    } as never);
    const b = await LocalStorageService.saveNew('u1', {
      title: 'n', content: 'одинаковый текст', wordCount: 2, duration: 0, wpm: 0,
      tags: [], sessionStartedAt: new Date(2000),
    } as never);

    const db = await getLocalDb('u1');
    const ua = (await db.get('documents', a.localId))!.uuid;
    const ub = (await db.get('documents', b.localId))!.uuid;
    // Тот самый случай, на котором ломалась сшивка по содержимому.
    expect(ua).not.toBe(ub);
  });

  it('backfills notes created before the field existed, and only those', async () => {
    const db = await getLocalDb('u1');
    await db.put('documents', {
      id: 'local_old', guestId: 'u1', title: 'n', currentVersion: 1, totalWords: 1,
      totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [],
    } as never);
    await db.put('documents', {
      id: 'local_has', guestId: 'u1', uuid: 'keep-me', title: 'n', currentVersion: 1,
      totalWords: 1, totalDuration: 0, sessionsCount: 1, firstSessionAt: 1,
      lastSessionAt: 1, tags: [],
    } as never);

    const filled = await LocalDocumentService.backfillDocumentUuids('u1');

    expect(filled).toBe(1);
    expect((await db.get('documents', 'local_old'))!.uuid).toBeTruthy();
    // Уже назначенный uuid не переписывается никогда: он и есть имя заметки.
    expect((await db.get('documents', 'local_has'))!.uuid).toBe('keep-me');
  });

  it('is idempotent', async () => {
    await LocalDocumentService.backfillDocumentUuids('u1');
    expect(await LocalDocumentService.backfillDocumentUuids('u1')).toBe(0);
  });
});

// LIFE-10: новая облачная копия под новым номером. Производные ИИ несут номер
// в documentUuid, и при выгрузке он главнее номера заметки: останься там
// старый — база (0035) вечно отвергала бы их как запись под надгробием.
describe('a note that gets a new uuid', () => {
  beforeEach(clear);

  it('moves its local summary and embedding to the new uuid', async () => {
    const db = await getLocalDb('u1');
    await db.put('documents', {
      id: 'local_re', guestId: 'u1', uuid: 'buried', title: 'n', currentVersion: 1,
      totalWords: 1, totalDuration: 0, sessionsCount: 1, firstSessionAt: 1,
      lastSessionAt: 1, tags: [],
    } as never);
    await db.put('aiSummaries', {
      documentId: 'local_re', documentUuid: 'buried', tone: '', frequentWords: [],
      insights: [], themes: [], extractedFacts: [], processedAt: 1,
    });
    await db.put('aiEmbeddings', {
      documentId: 'local_re', documentUuid: 'buried', vectors: [[1]], model: 'm',
      dim: 1, contentHash: 'h', processedAt: 1,
    });

    await LocalDocumentService.updateDocumentUuid('local_re', 'fresh', 'u1');

    expect((await db.get('documents', 'local_re'))!.uuid).toBe('fresh');
    expect((await db.get('aiSummaries', 'local_re'))!.documentUuid).toBe('fresh');
    expect((await db.get('aiEmbeddings', 'local_re'))!.documentUuid).toBe('fresh');
  });
});
