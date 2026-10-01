import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLocalDb, resetDbInstance, hasLocalDatabase } from '../../../core/storage/localDb';

// S-28: что делает кнопка «Удалить данные с этого устройства», когда выхода как
// события уже не было — getCurrentUser() пуст, и uid должен приходить явно,
// иначе стирание уйдёт в гостевую базу вместо базы этого человека.

const USER = 'user_s28_exec';
const GUEST_ID = 'guest_s28_exec';

vi.mock('../../../core/auth', () => ({
  getCurrentUser: () => null,
  getCurrentUserId: () => null,
}));

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  resetDbInstance();
  for (const name of ['justwriting-local', `justwriting-local-${USER}`]) {
    await new Promise<void>(resolve => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  }
  const userDb = await getLocalDb(USER);
  await userDb.put('documents', {
    id: 'doc_user', guestId: USER, title: 'Копия аккаунта', currentVersion: 1,
    totalWords: 2, totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [],
  } as never);
  const guest = await getLocalDb('justwriting-local');
  await guest.put('documents', {
    id: 'doc_guest', guestId: GUEST_ID, title: 'Гостевая заметка', currentVersion: 1,
    totalWords: 2, totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [],
  } as never);
  // S-33: строка другого аккаунта, не входившего сюда после разделения баз.
  await guest.put('documents', {
    id: 'doc_other', guestId: 'user_s28_other', title: 'Заметка другого аккаунта', currentVersion: 1,
    totalWords: 2, totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [],
  } as never);
  localStorage.setItem(`ai_user_portrait_${USER}`, 'портрет в кэше');
});

describe('S-28: wipeDeviceDataForUid', () => {
  it('removes this uid’s database, the guest database and every uid key', async () => {
    const { AuthService } = await import('../services/AuthService');

    await AuthService.wipeDeviceDataForUid(USER);

    expect(await hasLocalDatabase(USER)).toBe(false);
    const guest = await getLocalDb('justwriting-local');
    expect((await guest.getAll('documents')).map(d => d.id), 'гостевая заметка осталась / чужая стёрта').toEqual(['doc_other']);
    expect(Object.keys(localStorage).filter(k => k.includes(USER))).toEqual([]);
  });
});
