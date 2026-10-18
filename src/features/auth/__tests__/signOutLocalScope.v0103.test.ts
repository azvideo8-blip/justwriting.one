// 0.10.3 (журнал владельца 2026-10-18): обычный выход шёл без scope, а supabase-js
// по умолчанию выходит глобально — GoTrue удалял refresh-токены всех сессий, и
// второе устройство при пробуждении вылетало («Refresh Token Not Found»).
// Выход обязан быть локальным. Мутация: вызвать signOutUser() без scope — красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

const USER = 'u_local_signout';
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

describe('выход из аккаунта', () => {
  beforeEach(() => { signOutUser.mockClear(); });

  it('обычный «Выйти» закрывает только эту сессию (scope local)', async () => {
    const { AuthService } = await import('../services/AuthService');
    await AuthService.signOut();
    expect(signOutUser).toHaveBeenCalledTimes(1);
    expect(signOutUser).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('«Выйти на других устройствах» по-прежнему others', async () => {
    const { AuthService } = await import('../services/AuthService');
    await AuthService.signOutOthers();
    expect(signOutUser).toHaveBeenCalledWith({ scope: 'others' });
  });
});
