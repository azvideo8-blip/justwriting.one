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

  /**
   * S-48: маркер пишется только после подтверждения сервера, так что «маркер +
   * сохранённая сессия» — это вкладка, умершая между удалением на сервере и
   * signOutUser. Прежняя защита «живая сессия — не стирать» оставляла базу
   * удалённого аккаунта и восстанавливала его сессию до истечения токена.
   */
  it('a marker with a stored supabase session for that uid purges the database and clears the session (the crash between server delete and sign-out)', async () => {
    mockGetCurrentUser.mockReturnValue(null);
    localStorage.setItem('sb-mock-auth-token', JSON.stringify({ access_token: 'x', user: { id: USER } }));
    localStorage.setItem('sb-mock-other-auth-token', JSON.stringify({ access_token: 'y', user: { id: 'someone_else' } }));
    localStorage.setItem(MARKER, '1');

    await processPendingPurges();

    expect(await hasLocalDatabase(USER), 'база удалённого аккаунта осталась').toBe(false);
    expect(localStorage.getItem('sb-mock-auth-token'), 'сессия удалённого аккаунта осталась').toBeNull();
    expect(localStorage.getItem('sb-mock-other-auth-token'), 'снята чужая сессия').not.toBeNull();
    expect(localStorage.getItem(MARKER)).toBeNull();
    const guest = await getLocalDb('justwriting-local');
    expect((await guest.getAll('documents')).map(d => d.id), 'гостевые данные удалённого аккаунта остались').toEqual([]);
  });

  // S-63.4 (S-48): после доочистки на старте ключи localStorage удалённого
  // аккаунта (в т.ч. открытый `draft-<uid>`) оставались — в отличие от wipeDeviceDataForUid.
  it('S-63: the boot purge also clears the deleted account\'s localStorage keys, not another account\'s', async () => {
    mockGetCurrentUser.mockReturnValue(null);
    localStorage.setItem(MARKER, '1');
    localStorage.setItem(`draft-${USER}`, JSON.stringify({ content: 'открытый черновик удалённого аккаунта' }));
    localStorage.setItem('draft-someone_else', JSON.stringify({ content: 'чужой черновик' }));

    const { finishPendingPurges } = await import('../services/bootPurge');
    await finishPendingPurges();

    expect(await hasLocalDatabase(USER)).toBe(false);
    expect(localStorage.getItem(`draft-${USER}`), 'черновик удалённого аккаунта остался').toBeNull();
    expect(localStorage.getItem('draft-someone_else')).not.toBeNull();
    expect(localStorage.getItem(MARKER)).toBeNull();
  });

  // S-48 survivor (S-63): сессия снимается до первого await — иначе клиент успевает её восстановить.
  it('S-48 survivor: the stored session is already gone when the first database delete starts', async () => {
    mockGetCurrentUser.mockReturnValue(null);
    localStorage.setItem('sb-mock-auth-token', JSON.stringify({ access_token: 'x', user: { id: USER } }));
    localStorage.setItem(MARKER, '1');
    const sessionAtDelete: (string | null)[] = [];
    const orig = indexedDB.deleteDatabase.bind(indexedDB);
    const spy = vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation((name: string) => {
      sessionAtDelete.push(localStorage.getItem('sb-mock-auth-token'));
      return orig(name);
    });
    try {
      await processPendingPurges();
    } finally {
      spy.mockRestore();
    }
    expect(sessionAtDelete.length).toBeGreaterThan(0);
    expect(sessionAtDelete, 'сессия ещё лежала, когда началось удаление базы').toEqual(sessionAtDelete.map(() => null));
  });

  it('a marker for a uid with no session here is still honoured (the real crash-recovery case)', async () => {
    mockGetCurrentUser.mockReturnValue(null);
    localStorage.setItem(MARKER, '1');

    await processPendingPurges();

    expect(await hasLocalDatabase(USER)).toBe(false);
    expect(localStorage.getItem(MARKER)).toBeNull();
  });
});

// c7bff480 (S-32 follow-up): маркер, который не записался или не снялся, — не
// молчание: без него сбой локальной очистки некому доделать.
describe('S-48: purge marker write/remove failures are reported', () => {
  it('setItem throwing for the marker is reported, deletion still proceeds', async () => {
    mockCallAi.mockResolvedValueOnce({});
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === MARKER) throw new DOMException('quota', 'QuotaExceededError');
      Object.defineProperty(this, key, { value, configurable: true, enumerable: true, writable: true });
    });
    try {
      const { AuthService } = await import('../services/AuthService');
      await AuthService.deleteAccount('secretPassword');
    } finally {
      setItem.mockRestore();
    }
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'QuotaExceededError' }),
      expect.objectContaining({ action: 'deleteAccount_purgeMarker' }),
      'warning',
    );
  });

  it('removeItem throwing for the marker is reported', async () => {
    mockCallAi.mockResolvedValueOnce({});
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key: string) {
      if (key === MARKER) throw new Error('storage gone');
      delete (this as unknown as Record<string, unknown>)[key];
    });
    try {
      const { AuthService } = await import('../services/AuthService');
      await AuthService.deleteAccount('secretPassword');
    } finally {
      removeItem.mockRestore();
    }
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'storage gone' }),
      expect.objectContaining({ action: 'deleteAccount_purgeMarker' }),
      'warning',
    );
  });
});
