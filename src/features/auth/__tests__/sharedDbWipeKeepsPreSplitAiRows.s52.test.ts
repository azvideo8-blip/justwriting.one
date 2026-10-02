import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLocalDb, resetDbInstance, hasLocalDatabase, wipeGuestAndAccountFromSharedDb } from '../../../core/storage/localDb';

// S-52 (S-33.1): общая база `justwriting-local` хранит и строки ИИ без
// владельца. Гость их создать не может (callAi требует токен), а записи
// аккаунта A после разделения баз живут в его собственной базе — значит, они
// принадлежат аккаунту B, который ещё не входил после разделения. Удаление A
// стирало их, и B при первом входе получал заметки без диалогов.

const A = 'user_s52_a';
const B = 'user_s52_b';

let mockCurrentUser: { uid: string; email: string } | null = null;

vi.mock('../../../core/auth', () => ({
  getCurrentUser: () => mockCurrentUser,
  getCurrentUserId: () => mockCurrentUser?.uid ?? null,
}));

function doc(id: string, guestId: string) {
  return { id, guestId, title: id, currentVersion: 1, totalWords: 1, totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [] } as never;
}

async function dropAll(): Promise<void> {
  resetDbInstance();
  for (const name of ['justwriting-local', `justwriting-local-${A}`, `justwriting-local-${B}`]) {
    await new Promise<void>(resolve => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  }
}

beforeEach(async () => {
  localStorage.clear();
  mockCurrentUser = { uid: A, email: 'a@example.com' };
  await dropAll();
});

describe('S-52: deleting account A keeps the pre-split AI rows for account B', () => {
  it('ownerless dialogues survive the wipe and B claims them at first sign-in', async () => {
    const shared = await getLocalDb('justwriting-local');
    await shared.put('documents', doc('doc_b', B));
    await shared.put('aiDialogues', { id: 'dlg_b', title: 'Диалог B', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯', messages: [], createdAt: 1, updatedAt: 1 } as never);
    await shared.put('aiSummaries', { documentId: 'doc_b', tone: 'ровный', frequentWords: [], insights: [], themes: [], extractedFacts: [], processedAt: 1, contentHash: 'h' } as never);

    await wipeGuestAndAccountFromSharedDb(A);

    const after = await getLocalDb('justwriting-local');
    expect((await after.getAll('aiDialogues')).map(d => d.id), 'диалоги B стёрты удалением A').toEqual(['dlg_b']);
    expect((await after.getAll('aiSummaries')).map(d => d.documentId)).toEqual(['doc_b']);

    // B входит впервые после разделения баз: миграция забирает заметку и диалог.
    mockCurrentUser = { uid: B, email: 'b@example.com' };
    resetDbInstance();
    const bDb = await getLocalDb(B);
    expect((await bDb.getAll('documents')).map(d => d.id)).toEqual(['doc_b']);
    expect((await bDb.getAll('aiDialogues')).map(d => d.id), 'B не получил свои диалоги').toEqual(['dlg_b']);
  });

  it('the shared database file stays while a sync-queue or pending-session row of another account is left', async () => {
    const shared = await getLocalDb('justwriting-local');
    await shared.put('syncQueue', { id: 'q_b', ownerId: B, type: 'document', documentId: 'doc_b', attempts: 0, createdAt: 1 } as never);

    await wipeGuestAndAccountFromSharedDb(A);

    expect(await hasLocalDatabase('justwriting-local'), 'файл базы удалён вместе с очередью B').toBe(true);
    expect((await (await getLocalDb('justwriting-local')).getAll('syncQueue')).map(q => q.id)).toEqual(['q_b']);
  });

  // S-52 survivor (S-63): pending_sessions тоже считается в «что-то осталось».
  it('a leftover pending_sessions row of another account keeps the file', async () => {
    const shared = await getLocalDb('justwriting-local');
    await shared.put('pending_sessions', { sessionId: null, data: {}, userId: B } as never);

    await wipeGuestAndAccountFromSharedDb(A);

    expect(await hasLocalDatabase('justwriting-local'), 'файл базы удалён вместе с отложенной сессией B').toBe(true);
    expect((await (await getLocalDb('justwriting-local')).getAll('pending_sessions')).map(p => p.userId)).toEqual([B]);
  });

  it('the file goes when only guest and A rows were in it', async () => {
    const shared = await getLocalDb('justwriting-local');
    await shared.put('documents', doc('doc_a', A));
    await shared.put('documents', doc('doc_guest', 'guest_x'));

    await wipeGuestAndAccountFromSharedDb(A);

    expect(await hasLocalDatabase('justwriting-local')).toBe(false);
  });
});
