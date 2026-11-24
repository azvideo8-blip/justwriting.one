import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { getLocalDb, resetDbInstance, hasLocalDatabase } from '../../../core/storage/localDb';
import { offerLostSessionWipe } from '../services/lostSessionWipe';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
// Счёт неотправленного грузит этот модуль по требованию; холодная загрузка съедает секунду waitFor.
import '../../../core/services/LocalStoreSyncService';

// S-28: устройство, где вход оборвался не по воле человека, получает предложение
// стереть данные — а не молчаливый разлогин с сохранённой базой.

const USER = 'user_s28_lost';

vi.mock('../services/AuthService', () => ({
  AuthService: { wipeDeviceDataForUid: vi.fn(async () => {}) },
}));

// S-33.2: кнопка тоста открывает подтверждение; без «да» ничего не стирается.
const confirm = vi.fn(async (_opts: { title: string; message?: string; confirmLabel?: string; destructive?: boolean }) => true);
const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}:${Object.values(params).join(',')}` : key;

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

    await offerLostSessionWipe(showToast, t, confirm);

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
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'auth_lost_session_wipe_confirm_title',
      message: expect.stringContaining('auth_lost_session_wipe_confirm_message'),
      destructive: true,
    }));
  });

  // Ревью 0.11.25: журнал ИИ не читается — стирание не запирается: предложение одноразовое,
  // а войти и стереть иначе уже нельзя (аккаунт мог быть удалён). База не читается — S-33 ниже.
  // Мутации: бросать на нечитаемом журнале — красный; убрать фразу «не удалось проверить» — красный.
  it('AI journal unreadable — the confirmation says so and the wipe still goes', async () => {
    await seedUserDb();
    localStorage.setItem(STORAGE_KEYS.LOST_SESSION_UID, USER);
    localStorage.setItem(`ai_sync_pending_upserts:${USER}`, '{broken');
    const showToast = vi.fn();

    await offerLostSessionWipe(showToast, t, confirm);
    (showToast.mock.calls[0]![2] as { onClick: () => void }).onClick();

    const { AuthService } = await import('../services/AuthService');
    await waitFor(() => expect(AuthService.wipeDeviceDataForUid).toHaveBeenCalledWith(USER));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('signout_unsynced_unknown_desc') }));
  });

  it('S-33: a declined confirmation wipes nothing', async () => {
    await seedUserDb();
    localStorage.setItem(STORAGE_KEYS.LOST_SESSION_UID, USER);
    const showToast = vi.fn();
    confirm.mockResolvedValueOnce(false);

    await offerLostSessionWipe(showToast, t, confirm);
    const action = showToast.mock.calls[0]![2] as { onClick: () => void };
    action.onClick();

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 20));
    const { AuthService } = await import('../services/AuthService');
    expect(AuthService.wipeDeviceDataForUid, 'стёрто без подтверждения').not.toHaveBeenCalled();
  });

  it('S-33: unsynced data on this device is named in the confirmation', async () => {
    await seedUserDb();
    const db = await getLocalDb(USER);
    await db.put('drafts', { userId: USER, title: '', content: 'несохранённый текст', seconds: 0, wpm: 0, wordCount: 2, updatedAt: 1 } as never);
    localStorage.setItem(STORAGE_KEYS.LOST_SESSION_UID, USER);
    const showToast = vi.fn();

    await offerLostSessionWipe(showToast, t, confirm);
    const action = showToast.mock.calls[0]![2] as { onClick: () => void };
    action.onClick();

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    const message = confirm.mock.calls[0]![0].message ?? '';
    // doc_lost без linkedCloudId + черновик = 2 несинхронизированных записи
    expect(message).toContain('auth_lost_session_wipe_confirm_unsynced:2');
  });

  it('S-33: when the unsynced count cannot be read, nothing is wiped', async () => {
    await seedUserDb();
    localStorage.setItem(STORAGE_KEYS.LOST_SESSION_UID, USER);
    const showToast = vi.fn();
    const unsynced = await import('../services/unsyncedLocalData');
    const spy = vi.spyOn(unsynced, 'countUnsyncedLocalData').mockRejectedValueOnce(new Error('IDB broken'));

    await offerLostSessionWipe(showToast, t, confirm);
    const action = showToast.mock.calls[0]![2] as { onClick: () => void };
    action.onClick();

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('auth_lost_session_wipe_failed', 'error'));
    const { AuthService } = await import('../services/AuthService');
    expect(AuthService.wipeDeviceDataForUid).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('stays quiet when there is nothing of this uid on the device', async () => {
    localStorage.setItem(STORAGE_KEYS.LOST_SESSION_UID, 'user_that_never_lived_here');
    const showToast = vi.fn();

    await offerLostSessionWipe(showToast, t, confirm);

    expect(showToast).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEYS.LOST_SESSION_UID)).toBeNull();
  });

  it('stays quiet without a recorded uid', async () => {
    await seedUserDb();
    const showToast = vi.fn();

    await offerLostSessionWipe(showToast, t, confirm);

    expect(showToast).not.toHaveBeenCalled();
  });
});
