// MS-4: выход из аккаунта — что стирается и что остаётся.
// Три входа, на которых старая проверка молчала:
//   1) обычный «Выйти» (локальные данные сохраняются) обязан снести
//      сессионные ключи учётки: иначе `pending_keys_<uid>` с ключами сейфа
//      переживает перезагрузку вкладки, которую делает сам выход;
//   2) выход не состоялся (`signOutUser` отказал) — сообщения «Вы вышли» быть
//      не должно: новая страница показала бы его поверх живой сессии;
//   3) код восстановления сейфа — учётные данные: обычный выход убирает свой,
//      а код другого аккаунта этого браузера не трогает.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

const USER = 'u_ms4_signout';
const OTHER = 'u_ms4_other';
const signOutUser = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: USER, email: 'user@example.com' }),
  getCurrentUserId: () => USER,
  signOutUser,
}));
vi.mock('../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: { getState: () => ({ lockVault: vi.fn() }) },
}));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { getLocalDb } from '../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { _resetAccountReloadForTesting, takeAccountChangeNotice } from '../../../core/auth/accountReload';

const SESSION_KEYS = [
  `pending_keys_${USER}`,
  STORAGE_KEYS.DRAFT_DELETED(USER),
  `jw_other_user_dismissed_${USER}`,
  STORAGE_KEYS.VAULT_AUTO_UNLOCK_FAILED(USER),
];

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  signOutUser.mockReset().mockResolvedValue(undefined);
  _resetAccountReloadForTesting();
  const db = await getLocalDb(USER);
  for (const rec of await db.getAll('documents')) await db.delete('documents', (rec as { id: string }).id);
});

describe('MS-4: выход из аккаунта', () => {
  it('обычный выход сносит сессионные ключи учётки, а локальные заметки оставляет', async () => {
    const db = await getLocalDb(USER);
    await db.put('documents', {
      id: 'local_ms4_keep', guestId: USER, title: 'MARKER_MS4_локальная_заметка',
      currentVersion: 1, totalWords: 2, totalDuration: 0, sessionsCount: 1,
      firstSessionAt: 1, lastSessionAt: 1, tags: [],
    } as never);
    for (const key of SESSION_KEYS) sessionStorage.setItem(key, 'MARKER_MS4_сессия');

    const { AuthService } = await import('../services/AuthService');
    await AuthService.signOut();

    for (const key of SESSION_KEYS) {
      expect(sessionStorage.getItem(key), `сессионный ключ ${key} пережил выход`).toBeNull();
    }
    // signOut пересоздаёт соединение (`resetDbInstance`) — база читается заново.
    const after = await getLocalDb(USER);
    expect(await after.get('documents', 'local_ms4_keep'), 'обычный выход не стирает локальную базу').toBeTruthy();
    expect(signOutUser).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('выход не состоялся — «Вы вышли» на следующей странице не показывается', async () => {
    signOutUser.mockRejectedValueOnce(new Error('MARKER_MS4_сеть_отказала'));
    const { AuthService } = await import('../services/AuthService');

    await expect(AuthService.signOut()).rejects.toThrow('MARKER_MS4_сеть_отказала');

    expect(takeAccountChangeNotice(), 'сообщение об успешном выходе осталось при отказе').toBeNull();
  });

  it('код восстановления: свой сносится, код другого аккаунта остаётся', async () => {
    localStorage.setItem(STORAGE_KEYS.PENDING_RECOVERY_CODE(USER), 'MARKER_MS4_RECOVERY');
    localStorage.setItem(STORAGE_KEYS.PENDING_RECOVERY_CODE(OTHER), 'MARKER_MS4_OTHER_RECOVERY');

    const { AuthService } = await import('../services/AuthService');
    await AuthService.signOut();

    expect(localStorage.getItem(STORAGE_KEYS.PENDING_RECOVERY_CODE(USER)), 'код восстановления пережил выход').toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.PENDING_RECOVERY_CODE(OTHER)), 'код другого аккаунта не тронут').toBe('MARKER_MS4_OTHER_RECOVERY');
  });
});
