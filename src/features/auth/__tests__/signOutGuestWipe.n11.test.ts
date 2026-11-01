// N1-1 (дейлик 01.11, Н-1): диалог выхода с галочкой «Это чужой компьютер —
// удалить все данные» обещает чистое браузерное хранилище, но из общей базы
// `justwriting-local` убирались только строки этого uid (`purgeAccountFromSharedDb`
// внутри `clearAllLocalStores`), а гостевые оставались. Подметание
// `clearAccountScopedStorage` при этом стирало `jw_guest_id` — строки физически
// лежали в браузере, но открыть или удалить их было уже нечем.
// Второй вход — удаление аккаунта (`AuthService.ts:111`) и `wipeDeviceDataForUid`
// (`:377`) — гостевое стирал. Класс «правка в одном из двух входов».
// Мутация: убрать `wipeGuestAndAccountFromSharedDb` из ветки `clearLocalData` →
// «гостевые строки уходят» красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import { getLocalDb, resetDbInstance } from '../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';

const USER = 'u_n1_signout';
const GUEST_ID = 'guest_marker_n1';
const OTHER_ACCOUNT = 'u_n1_other';

const signOutUser = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: USER, email: 'someone@example.com' }),
  getCurrentUserId: () => USER,
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOutUser,
  sendPasswordResetEmail: vi.fn(),
  reauthenticate: vi.fn(async () => {}),
}));
vi.mock('../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: { getState: () => ({ lockVault: vi.fn() }) },
}));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

async function dropDatabases(): Promise<void> {
  resetDbInstance();
  for (const name of ['justwriting-local', `justwriting-local-${USER}`, `justwriting-local-${OTHER_ACCOUNT}`]) {
    await new Promise<void>(resolve => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  }
}

/** Гостевые строки общей базы + строки второго аккаунта, который выхода не касался. */
async function seedSharedDb(): Promise<void> {
  const shared = await getLocalDb('justwriting-local');
  await shared.put('documents', { id: 'gd_n1', guestId: GUEST_ID, title: 'MARKER_N1_GUEST_TITLE', currentVersion: 1 } as never);
  await shared.put('versions', { id: 'gv_n1', documentId: 'gd_n1', guestId: GUEST_ID, version: 1, content: 'MARKER_N1_GUEST_TEXT' } as never);
  await shared.put('drafts', { userId: GUEST_ID, title: 'MARKER_N1_GUEST_DRAFT', content: 'текст черновика', updatedAt: 1 } as never);
  await shared.put('documents', { id: 'od_n1', guestId: OTHER_ACCOUNT, title: 'MARKER_N1_OTHER_TITLE', currentVersion: 1 } as never);
}

async function guestRows(): Promise<{ docs: unknown[]; versions: unknown[]; drafts: unknown[] }> {
  const shared = await getLocalDb('justwriting-local');
  return {
    docs: (await shared.getAll('documents')).filter(d => (d as { guestId?: string }).guestId === GUEST_ID),
    versions: (await shared.getAll('versions')).filter(v => (v as { guestId?: string }).guestId === GUEST_ID),
    drafts: (await shared.getAll('drafts')).filter(d => (d as { userId?: string }).userId === GUEST_ID),
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  await dropDatabases();
});

describe('N1-1: «выйти и удалить все данные» обязан уносить и гостевые строки', () => {
  it('с галочкой в общей базе не остаётся ни гостевых заметок, ни версий, ни черновика', async () => {
    await seedSharedDb();
    localStorage.setItem(STORAGE_KEYS.GUEST_ID, GUEST_ID);
    localStorage.setItem(STORAGE_KEYS.GUEST_DRAFT, JSON.stringify({ content: 'MARKER_N1_GUEST_DRAFT_LS' }));

    const { AuthService } = await import('../services/AuthService');
    await AuthService.signOut({ clearLocalData: true, force: true });

    const after = await guestRows();
    expect(after.docs, 'гостевая заметка пережила выход «удалить все данные»').toEqual([]);
    expect(after.versions, 'гостевая версия пережила выход «удалить все данные»').toEqual([]);
    expect(after.drafts, 'гостевой черновик IndexedDB пережил выход «удалить все данные»').toEqual([]);
  });

  it('гостевой черновик в localStorage уходит этой же веткой', async () => {
    await seedSharedDb();
    localStorage.setItem(STORAGE_KEYS.GUEST_ID, GUEST_ID);
    localStorage.setItem(STORAGE_KEYS.GUEST_DRAFT, JSON.stringify({ content: 'MARKER_N1_GUEST_DRAFT_LS' }));

    const { AuthService } = await import('../services/AuthService');
    await AuthService.signOut({ clearLocalData: true, force: true });

    expect(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_ID)).toBeNull();
  });

  it('обычный выход (без галочки) оставляет гостевое — signout_local_preserved_desc не ломаем', async () => {
    await seedSharedDb();
    localStorage.setItem(STORAGE_KEYS.GUEST_ID, GUEST_ID);
    localStorage.setItem(STORAGE_KEYS.GUEST_DRAFT, JSON.stringify({ content: 'MARKER_N1_GUEST_DRAFT_LS' }));

    const { AuthService } = await import('../services/AuthService');
    await AuthService.signOut();

    const after = await guestRows();
    expect(after.docs).toHaveLength(1);
    expect(after.versions).toHaveLength(1);
    expect(after.drafts).toHaveLength(1);
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_ID)).toBe(GUEST_ID);
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT)).not.toBeNull();
  });

  it('строки второго аккаунта этой базы выхода не касаются', async () => {
    await seedSharedDb();

    const { AuthService } = await import('../services/AuthService');
    await AuthService.signOut({ clearLocalData: true, force: true });

    const shared = await getLocalDb('justwriting-local');
    const others = (await shared.getAll('documents')).filter(d => (d as { guestId?: string }).guestId === OTHER_ACCOUNT);
    expect(others, 'выход одного человека стёр заметку другого').toHaveLength(1);
  });
});
