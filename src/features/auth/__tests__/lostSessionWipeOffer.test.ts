import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { getLocalDb, resetDbInstance, hasLocalDatabase } from '../../../core/storage/localDb';
import { offerLostSessionWipe } from '../services/lostSessionWipe';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';

// S-28: устройство, где вход оборвался не по воле человека, получает предложение
// стереть данные — а не молчаливый разлогин с сохранённой базой.

const USER = 'user_s28_lost';

vi.mock('../services/AuthService', () => ({
  AuthService: { wipeDeviceDataForUid: vi.fn(async () => {}) },
}));

async function seedUserDb(): Promise<void> {
  const db = await getLocalDb(USER);
  await db.put('documents', {
    id: 'doc_lost', guestId: USER, title: 'Копия на этом устройстве', currentVersion: 1,
    totalWords: 3, totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [],
  } as never);
}

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
});

describe('S-28: the lost-session wipe offer', () => {
  it('offers the wipe when this uid still has a local database', async () => {
    await seedUserDb();
    expect(await hasLocalDatabase(USER)).toBe(true);
    localStorage.setItem(STORAGE_KEYS.LOST_SESSION_UID, USER);
    const showToast = vi.fn();

    await offerLostSessionWipe(showToast, (k: string) => k);

    expect(showToast).toHaveBeenCalledWith(
      'auth_lost_session_wipe_hint',
      'warning',
      expect.objectContaining({ label: 'auth_lost_session_wipe_button' }),
    );
    // Одноразово: ключ потрачен, при следующем старте предложение не повторится.
    expect(localStorage.getItem(STORAGE_KEYS.LOST_SESSION_UID)).toBeNull();

    const action = showToast.mock.calls[0]![2] as { onClick: () => void };
    action.onClick();
    const { AuthService } = await import('../services/AuthService');
    await waitFor(() => {
      expect(AuthService.wipeDeviceDataForUid).toHaveBeenCalledWith(USER);
    });
  });

  it('stays quiet when there is nothing of this uid on the device', async () => {
    localStorage.setItem(STORAGE_KEYS.LOST_SESSION_UID, 'user_that_never_lived_here');
    const showToast = vi.fn();

    await offerLostSessionWipe(showToast, (k: string) => k);

    expect(showToast).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEYS.LOST_SESSION_UID)).toBeNull();
  });

  it('stays quiet without a recorded uid', async () => {
    await seedUserDb();
    const showToast = vi.fn();

    await offerLostSessionWipe(showToast, (k: string) => k);

    expect(showToast).not.toHaveBeenCalled();
  });
});
