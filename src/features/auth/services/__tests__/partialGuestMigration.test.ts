import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { getLocalDb, getOrCreateGuestId } from '../../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { migrateDocuments } from '../migrateDocuments';

const USER_ID = 'user_partial_test';

beforeEach(async () => {
  localStorage.clear();
  vi.restoreAllMocks();

  for (const uid of ['justwriting-local', USER_ID]) {
    const db = await getLocalDb(uid);
    const tx = db.transaction(['drafts', 'documents', 'versions'], 'readwrite');
    await tx.objectStore('drafts').clear();
    await tx.objectStore('documents').clear();
    await tx.objectStore('versions').clear();
    await tx.done;
  }
});

describe('N-68: Partial guest migration', () => {
  it('failure on 2nd of 3 notes returns left=2, does not set MIGRATION_DECLINED, retry moves remainder', async () => {
    const guestId = getOrCreateGuestId();
    const guestDb = await getLocalDb('justwriting-local');

    // Seed 3 notes
    for (const id of ['doc_1', 'doc_2', 'doc_3']) {
      await guestDb.put('documents', {
        id,
        guestId,
        title: `Note ${id}`,
        currentVersion: 1,
        totalWords: 10,
        totalDuration: 60,
        sessionsCount: 1,
        firstSessionAt: Date.now(),
        lastSessionAt: Date.now(),
        tags: [],
      } as never);
      await guestDb.put('versions', {
        id: `v_${id}`,
        documentId: id,
        guestId,
        version: 1,
        content: `Content ${id}`,
        wordCount: 10,
        duration: 60,
        wpm: 10,
        savedAt: Date.now(),
        sessionStartedAt: Date.now(),
      } as never);
    }

    const userDb = await getLocalDb(USER_ID);
    const origUserTx = userDb.transaction.bind(userDb);

    let doc2Failed = false;
    vi.spyOn(userDb, 'transaction').mockImplementation((storeNames, mode) => {
      const tx = origUserTx(storeNames, mode) as any;
      const store = tx.objectStore('documents');
      const origPut = store.put.bind(store);
      store.put = ((val: any) => {
        if (val.id === 'doc_2' && !doc2Failed) {
          doc2Failed = true;
          throw new Error('SIMULATED_DOC_2_FAILURE');
        }
        return origPut(val);
      }) as any;
      return tx;
    });

    // 1st migration run: doc_1 succeeds, doc_2 fails, doc_3 not attempted yet
    const result = await migrateDocuments(USER_ID);
    expect(result).toEqual({ moved: 1, left: 2 });
    expect(localStorage.getItem(STORAGE_KEYS.MIGRATION_DECLINED(USER_ID))).toBeNull();

    // doc_1 migrated to userDb and removed from guestDb
    expect(await userDb.get('documents', 'doc_1')).toBeDefined();
    expect(await guestDb.get('documents', 'doc_1')).toBeUndefined();

    // doc_2 and doc_3 still in guestDb and not in userDb
    expect(await guestDb.get('documents', 'doc_2')).toBeDefined();
    expect(await guestDb.get('documents', 'doc_3')).toBeDefined();
    expect(await userDb.get('documents', 'doc_2')).toBeUndefined();
    expect(await userDb.get('documents', 'doc_3')).toBeUndefined();

    // 2nd migration run: retry succeeds for the remainder
    const retryResult = await migrateDocuments(USER_ID);
    expect(retryResult).toEqual({ moved: 2, left: 0 });

    // all 3 now in userDb and gone from guestDb
    expect(await userDb.get('documents', 'doc_2')).toBeDefined();
    expect(await userDb.get('documents', 'doc_3')).toBeDefined();
    expect(await guestDb.get('documents', 'doc_2')).toBeUndefined();
    expect(await guestDb.get('documents', 'doc_3')).toBeUndefined();
  });

  it('source check: guestDb deletion MUST come after await userTx.done; without .catch', () => {
    const filePath = path.resolve(__dirname, '../migrateDocuments.ts');
    const src = fs.readFileSync(filePath, 'utf8');

    // 1. userTx.done must not have a .catch attached
    expect(src).not.toMatch(/userTx\.done\s*\.catch/);

    // 2. await userTx.done; must precede guest deletion
    const userTxDoneIdx = src.indexOf('await userTx.done;');
    const guestDeleteIdx = src.indexOf("guestTx.objectStore('documents').delete");

    expect(userTxDoneIdx).toBeGreaterThan(0);
    expect(guestDeleteIdx).toBeGreaterThan(userTxDoneIdx);
  });
});
