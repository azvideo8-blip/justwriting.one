import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLocalDb, resetDbInstance, processPendingPurges, hasLocalDatabase } from '../../../core/storage/localDb';

// S-33.1: общая база `justwriting-local` хранит и строки аккаунта B, который не
// входил сюда после разделения баз (migrateLegacyIfNeeded переносит их при его
// первом входе). Удаление аккаунта A (O-5: вместе с гостевыми данными) уносило
// файл базы целиком — и заметки B с ним. Три входа в стирание: удаление
// аккаунта, отложенная очистка при старте, стирание потерянной сессии.

const A = 'user_s33_a';
const B = 'user_s33_b';
const GUEST = 'guest_s33';

let mockCurrentUser: { uid: string; email: string } | null = null;

vi.mock('../../../core/auth', () => ({
  getCurrentUser: () => mockCurrentUser,
  getCurrentUserId: () => mockCurrentUser?.uid ?? null,
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOutUser: vi.fn(async () => { mockCurrentUser = null; }),
  sendPasswordResetEmail: vi.fn(),
  reauthenticate: vi.fn(async () => {}),
}));
vi.mock('../../../core/ai/callAi', () => ({ callAi: vi.fn(async () => ({ success: true })) }));

function doc(id: string, guestId: string) {
  return { id, guestId, title: id, currentVersion: 1, totalWords: 1, totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [] } as never;
}

async function seedShared(): Promise<void> {
  const shared = await getLocalDb('justwriting-local');
  await shared.put('documents', doc('doc_a', A));
  await shared.put('documents', doc('doc_b', B));
  await shared.put('documents', doc('doc_guest', GUEST));
  await shared.put('versions', { id: 'v_b', documentId: 'doc_b', guestId: B, version: 1, content: 'B', wordCount: 1, wordsAdded: 1, charsAdded: 1, duration: 1, wpm: 1, savedAt: 1, sessionStartedAt: 1 } as never);
  await shared.put('versions', { id: 'v_guest', documentId: 'doc_guest', guestId: GUEST, version: 1, content: 'G', wordCount: 1, wordsAdded: 1, charsAdded: 1, duration: 1, wpm: 1, savedAt: 1, sessionStartedAt: 1 } as never);
  await shared.put('drafts', { userId: B, title: '', content: 'черновик B', seconds: 0, wpm: 0, wordCount: 2, updatedAt: 1 } as never);
  await shared.put('drafts', { userId: GUEST, title: '', content: 'черновик гостя', seconds: 0, wpm: 0, wordCount: 2, updatedAt: 1 } as never);
  await shared.put('aiDialogues', { id: 'dlg_guest', title: 'Диалог гостя', personaId: 'coach', messages: [], createdAt: 1, updatedAt: 1 } as never);
  const aDb = await getLocalDb(A);
  await aDb.put('documents', doc('doc_a_own', A));
}

async function expectOnlyBRemains(): Promise<void> {
  expect(await hasLocalDatabase('justwriting-local'), 'файл общей базы удалён вместе со строками B').toBe(true);
  const shared = await getLocalDb('justwriting-local');
  expect((await shared.getAll('documents')).map(d => d.id), 'заметки B не пережили удаление A').toEqual(['doc_b']);
  expect((await shared.getAll('versions')).map(v => v.id)).toEqual(['v_b']);
  expect((await shared.getAll('drafts')).map(d => d.userId)).toEqual([B]);
  expect(await shared.getAll('aiDialogues'), 'гостевые производные ИИ остались').toEqual([]);
  expect(await hasLocalDatabase(A)).toBe(false);
}

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  mockCurrentUser = { uid: A, email: 'a@example.com' };
  resetDbInstance();
  for (const name of ['justwriting-local', `justwriting-local-${A}`]) {
    await new Promise<void>(resolve => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  }
  await seedShared();
});

describe('S-33: wiping A and the guest data keeps account B’s rows in the shared database', () => {
  it('deleteAccount', async () => {
    const { AuthService } = await import('../services/AuthService');
    await AuthService.deleteAccount('secretPassword');
    await expectOnlyBRemains();
  });

  it('processPendingPurges at boot', async () => {
    localStorage.setItem(`jw_pending_purge_${A}`, '1');
    mockCurrentUser = null;
    await processPendingPurges();
    await expectOnlyBRemains();
    expect(localStorage.getItem(`jw_pending_purge_${A}`)).toBeNull();
  });

  it('wipeDeviceDataForUid (lost session)', async () => {
    mockCurrentUser = null;
    const { AuthService } = await import('../services/AuthService');
    await AuthService.wipeDeviceDataForUid(A);
    await expectOnlyBRemains();
  });

  it('the shared database file goes only when nothing else is left in it', async () => {
    const shared = await getLocalDb('justwriting-local');
    await shared.delete('documents', 'doc_b');
    await shared.delete('versions', 'v_b');
    await shared.delete('drafts', B);
    const { AuthService } = await import('../services/AuthService');
    await AuthService.deleteAccount('secretPassword');
    expect(await hasLocalDatabase('justwriting-local')).toBe(false);
  });
});
