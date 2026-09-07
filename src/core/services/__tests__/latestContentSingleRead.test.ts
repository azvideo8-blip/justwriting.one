import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getLocalDb, clearAllLocalStores, type LocalVersion } from '../../storage/localDb';
import { LocalVersionService } from '../LocalVersionService';

describe('DUP-6: LocalVersionService.getLatestContent canonical single-row read', () => {
  const docId = 'doc_with_200_versions';

  beforeEach(async () => {
    await clearAllLocalStores();
  });

  it('reads only 1 row via cursor instead of loading all 200 versions into memory', async () => {
    const db = await getLocalDb();

    // Seed 200 versions for the document
    const tx = db.transaction('versions', 'readwrite');
    for (let v = 1; v <= 200; v++) {
      const versionRow: LocalVersion = {
        id: `v_${v}`,
        documentId: docId,
        guestId: 'guest_test',
        version: v,
        content: `Content of version ${v}`,
        wordCount: 10,
        duration: 60,
        wpm: 20,
        wordsAdded: 10,
        charsAdded: 50,
        goalReached: false,
        sessionStartedAt: 1000 + v,
        savedAt: 1000 + v,
      };
      await tx.store.put(versionRow);
    }
    await tx.done;

    // Spy on getAllFromIndex to ensure the O(N) path is NOT taken
    const getAllFromIndexSpy = vi.spyOn(db, 'getAllFromIndex');

    // Instrument openCursor to count how many cursor steps/reads happen
    const origTransaction = db.transaction.bind(db) as any;
    let rowsReadViaCursor = 0;

    vi.spyOn(db, 'transaction').mockImplementation(((storeNames: any, mode: any) => {
      const realTx = origTransaction(storeNames, mode);
      if (storeNames === 'versions') {
        const origStoreIndex = realTx.store.index.bind(realTx.store);
        vi.spyOn(realTx.store, 'index').mockImplementation(((indexName: any) => {
          const realIndex = origStoreIndex(indexName);
          const origOpenCursor = realIndex.openCursor.bind(realIndex);
          vi.spyOn(realIndex, 'openCursor').mockImplementation((async (...args: any[]) => {
            const cursor = await origOpenCursor(...args);
            if (cursor) {
              rowsReadViaCursor++;
              const origContinue = cursor.continue?.bind(cursor);
              if (origContinue) {
                vi.spyOn(cursor, 'continue').mockImplementation(() => {
                  rowsReadViaCursor++;
                  origContinue();
                });
              }
            }
            return cursor;
          }) as any);
          return realIndex;
        }) as any);
      }
      return realTx;
    }) as any);

    const content = await LocalVersionService.getLatestContent(docId);

    // Assert correct latest version content was read
    expect(content).toBe('Content of version 200');

    // Assert O(1) single row read
    expect(getAllFromIndexSpy).not.toHaveBeenCalled();
    expect(rowsReadViaCursor).toBe(1);

    // Falsification check: if we were using the old implementation:
    // const oldVersions = await db.getAllFromIndex('versions', 'by-document', docId);
    // it would read 200 rows into memory!
    const oldPathVersions = await db.getAllFromIndex('versions', 'by-document', docId);
    expect(oldPathVersions).toHaveLength(200);
    expect(getAllFromIndexSpy).toHaveBeenCalledTimes(1);
  });

  it('returns empty string when document has no versions', async () => {
    const content = await LocalVersionService.getLatestContent('non_existent_doc');
    expect(content).toBe('');
  });

  it('returns empty string when latest version content is empty string', async () => {
    const db = await getLocalDb();
    await db.put('versions', {
      id: 'v_empty',
      documentId: 'doc_empty',
      guestId: 'guest_test',
      version: 1,
      content: '',
      wordCount: 0,
      duration: 0,
      wpm: 0,
      wordsAdded: 0,
      charsAdded: 0,
      goalReached: false,
      sessionStartedAt: 1000,
      savedAt: 1000,
    });

    const content = await LocalVersionService.getLatestContent('doc_empty');
    expect(content).toBe('');
  });
});
