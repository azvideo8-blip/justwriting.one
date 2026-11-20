// FN-9 (дейлик 20.11, хвост Н-3): обычный выход всегда «забывает ключ устройства»
// (clearDeviceKey). Отказ там глотался в reportError, а на новой странице — зелёное
// «Выход выполнен»: ключ жив, и сейф при следующем входе откроется без пароля.
// Выход со стиранием (wipe_failed) уже честный — здесь не трогается.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

const USER = 'u_fn9_signout';
const signOutUser = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const clearDeviceKey = vi.hoisted(() => vi.fn());

vi.mock('../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: USER, email: 'user@example.com' }),
  getCurrentUserId: () => USER,
  signOutUser,
}));
vi.mock('../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: { getState: () => ({ lockVault: vi.fn() }) },
}));
vi.mock('../../../core/crypto/keyVaultCache', () => ({ clearDeviceKey }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { _resetAccountReloadForTesting, takeAccountChangeNotice } from '../../../core/auth/accountReload';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  signOutUser.mockReset().mockResolvedValue(undefined);
  clearDeviceKey.mockReset();
  _resetAccountReloadForTesting();
});

describe('FN-9: выход — итог про ключ устройства назван', () => {
  it('ключ устройства не стёрт при обычном выходе — на новой странице предупреждение, не «Выход выполнен»', async () => {
    clearDeviceKey.mockRejectedValue(new Error('MARKER_FN9_IDB_DOWN'));
    const { AuthService } = await import('../services/AuthService');
    await AuthService.signOut();
    expect(clearDeviceKey).toHaveBeenCalledWith(USER);
    expect(takeAccountChangeNotice()).toBe('signed_out_key_kept');
  });

  it('КОНТРОЛЬ: ключ стёрт — обычное «Выход выполнен»', async () => {
    clearDeviceKey.mockResolvedValue(undefined);
    const { AuthService } = await import('../services/AuthService');
    await AuthService.signOut();
    expect(takeAccountChangeNotice()).toBe('signed_out');
  });
});
