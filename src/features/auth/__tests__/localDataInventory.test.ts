import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../core/storage/localDb';
import {
  countLocalDataInventory,
  hasOtherUserData,
  clearOtherUserData,
} from '../services/localDataInventory';

describe('localDataInventory', () => {
  beforeEach(async () => {
    localStorage.clear();
    const db = await getLocalDb();
    const stores = [
      'documents',
      'versions',
      'aiPortrait',
      'aiDialogues',
      'aiProfileFacets',
      'lifeStory',
      'aiThemeLedger',
      'aiBeliefs',
    ] as const;
    for (const store of stores) {
      if (db.objectStoreNames.contains(store)) {
        await db.clear(store);
      }
    }
  });

  it('counts local data across notes, versions, and AI stores', async () => {
    const db = await getLocalDb();
    await db.put('documents', {
      id: 'doc_1',
      guestId: 'user_1',
      title: 'Note 1',
      currentVersion: 1,
      totalWords: 10,
      totalDuration: 0,
      sessionsCount: 1,
      firstSessionAt: 1,
      lastSessionAt: 1,
      tags: [],
    } as never);

    await db.put('aiDialogues', {
      id: 'd1',
      title: 'Chat 1',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
    } as never);

    await db.put('lifeStory', {
      eventDate: '2026-08-19',
      text: 'Story',
      generatedAt: 1,
    } as never);

    const inv = await countLocalDataInventory('user_1');
    expect(inv.notesCount).toBe(1);
    expect(inv.dialoguesCount).toBe(1);
    expect(inv.lifeStoryCount).toBe(1);
    expect(inv.totalItems).toBeGreaterThanOrEqual(3);
  });

  it('detects and clears other users data in multi-user environments', async () => {
    const db = await getLocalDb();
    // User A document
    await db.put('documents', {
      id: 'doc_a',
      guestId: 'user_A',
      title: 'User A note',
      currentVersion: 1,
      totalWords: 10,
      totalDuration: 0,
      sessionsCount: 1,
      firstSessionAt: 1,
      lastSessionAt: 1,
      tags: [],
    } as never);

    // User B document
    await db.put('documents', {
      id: 'doc_b',
      guestId: 'user_B',
      title: 'User B note',
      currentVersion: 1,
      totalWords: 10,
      totalDuration: 0,
      sessionsCount: 1,
      firstSessionAt: 1,
      lastSessionAt: 1,
      tags: [],
    } as never);

    expect(await hasOtherUserData('user_B')).toBe(true);
    expect(await hasOtherUserData('user_A')).toBe(true);

    // Clear user A's data while logged in as user B
    const clearRes = await clearOtherUserData('user_B');
    expect(clearRes.deletedDocs).toBe(1);

    // User B's note remains
    const docs = await db.getAll('documents');
    expect(docs).toHaveLength(1);
    expect(docs[0]?.guestId).toBe('user_B');
    expect(await hasOtherUserData('user_B')).toBe(false);
  });

  it('DEEP-10: counts versions without calling getAll on versions store', async () => {
    // LG-1: гостевой владелец — заметка аккаунта ушла бы миграцией в его базу, а
    // шпион и глобальный счёт смотрят в общую.
    const db = await getLocalDb();
    await db.put('documents', {
      id: 'doc_10',
      guestId: 'guest_10',
      title: 'Doc 10',
      currentVersion: 5,
      totalWords: 50,
      totalDuration: 0,
      sessionsCount: 5,
      firstSessionAt: 1,
      lastSessionAt: 5,
      tags: [],
    } as never);

    for (let i = 1; i <= 5; i++) {
      await db.put('versions', {
        id: `ver_10_${i}`,
        documentId: 'doc_10',
        version: i,
        content: `Long text content for version ${i}`.repeat(100),
        savedAt: i * 1000,
        wordsAdded: 10,
        pauseCount: 0,
      } as never);
    }

    const getAllSpy = vi.spyOn(db, 'getAll');

    const invScoped = await countLocalDataInventory('guest_10');
    expect(invScoped.notesCount).toBe(1);
    expect(invScoped.versionsCount).toBe(5);

    // Verify getAll('versions') was never called
    expect(getAllSpy).not.toHaveBeenCalledWith('versions');

    const invGlobal = await countLocalDataInventory();
    expect(invGlobal.versionsCount).toBe(5);
    expect(getAllSpy).not.toHaveBeenCalledWith('versions');

    getAllSpy.mockRestore();
  });
});
