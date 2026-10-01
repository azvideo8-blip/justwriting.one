import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, hasLocalDatabase, resetDbInstance, processPendingPurges } from '../../../core/storage/localDb';
import { reportError } from '../../../shared/errors/reportError';

// S-32: маркер отложенной очистки `jw_pending_purge_<uid>` ставился ДО вызова
// сервера и переживал его отказ — человек видел «не удалось удалить аккаунт»,
// писал дальше, а следующий старт стирал базу живого аккаунта вместе с гостевой.

const USER = 'u_s32_failed_delete';
const GUEST = 'guest_s32';
const MARKER = `jw_pending_purge_${USER}`;

const mockGetCurrentUser = vi.fn();
const mockCallAi = vi.fn();

vi.mock('../../../core/auth', () => ({
  getCurrentUser: () => mockGetCurrentUser(),
  getCurrentUserId: () => mockGetCurrentUser()?.uid ?? null,
  reauthenticate: vi.fn(async () => {}),
  signOutUser: vi.fn(async () => {}),
}));
vi.mock('../../../core/ai/callAi', () => ({ callAi: (...args: unknown[]) => mockCallAi(...args) }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

async function dropDatabases(): Promise<void> {
  resetDbInstance();
  for (const name of ['justwriting-local', `justwriting-local-${USER}`]) {
    await new Promise<void>(resolve => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  }
}

async function seed(): Promise<void> {
  const userDb = await getLocalDb(USER);
  await userDb.put('documents', {
    id: 'doc_user', guestId: USER, title: 'Несинхронизированная заметка', currentVersion: 1,
    totalWords: 2, totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [],
  } as never);
  const guest = await getLocalDb('justwriting-local');
  await guest.put('documents', {
    id: 'doc_guest', guestId: GUEST, title: 'Гостевая заметка', currentVersion: 1,
    totalWords: 2, totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [],
  } as never);
}

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  mockGetCurrentUser.mockReturnValue({ uid: USER, email: 'someone@example.com' });
  await dropDatabases();
  await seed();
});

describe('S-32: a failed account deletion must not wipe the live account on the next start', () => {
  it('server rejects → no purge marker, and the next boot purges nothing', async () => {
    mockCallAi.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { AuthService } = await import('../services/AuthService');

    await expect(AuthService.deleteAccount('secretPassword')).rejects.toThrow('Failed to fetch');

    expect(localStorage.getItem(MARKER), 'маркер пережил отказ сервера').toBeNull();

    // Следующий старт: сессия ещё не восстановлена, getCurrentUser() пуст.
    mockGetCurrentUser.mockReturnValue(null);
    await processPendingPurges();

    expect(await hasLocalDatabase(USER), 'база живого аккаунта стёрта').toBe(true);
    const guest = await getLocalDb('justwriting-local');
    expect((await guest.getAll('documents')).map(d => d.id)).toEqual(['doc_guest']);
  });

  it('a marker for the uid signed in right now purges nothing and is dropped', async () => {
    localStorage.setItem(MARKER, '1');

    await processPendingPurges();

    expect(await hasLocalDatabase(USER), 'база живого аккаунта стёрта').toBe(true);
    const guest = await getLocalDb('justwriting-local');
    expect((await guest.getAll('documents')).map(d => d.id)).toEqual(['doc_guest']);
    expect(localStorage.getItem(MARKER)).toBeNull();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'PENDING_PURGE_FOR_LIVE_SESSION' }),
      expect.objectContaining({ action: 'processPendingPurges_liveSession', uid: USER }),
      'warning',
    );
  });

  it('a stored supabase session for that uid counts as live too (boot runs before the session is restored)', async () => {
    mockGetCurrentUser.mockReturnValue(null);
    localStorage.setItem('sb-mock-auth-token', JSON.stringify({ access_token: 'x', user: { id: USER } }));
    localStorage.setItem(MARKER, '1');

    await processPendingPurges();

    expect(await hasLocalDatabase(USER), 'база аккаунта с сохранённой сессией стёрта').toBe(true);
    expect(localStorage.getItem(MARKER)).toBeNull();
  });

  it('a marker for a uid with no session here is still honoured (the real crash-recovery case)', async () => {
    mockGetCurrentUser.mockReturnValue(null);
    localStorage.setItem(MARKER, '1');

    await processPendingPurges();

    expect(await hasLocalDatabase(USER)).toBe(false);
    expect(localStorage.getItem(MARKER)).toBeNull();
  });
});
