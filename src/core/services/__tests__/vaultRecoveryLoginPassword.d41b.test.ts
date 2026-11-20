// d41b (Н-2): recoverVaultWithCode обещает «новый пароль и на сейф, и на вход —
// они снова одинаковые». Шаг updateUserPassword завёрнут в catch{reportError}
// без броска/флага: отказ провайдера аутентификации глотается, pendingLoginPassword
// уже стёрт, вызывающие (UnlockPrompt:100-101, EncryptionPasswordModal:209-216)
// показывают зелёное enc_recovery_success. Настоящая криптография и
// EncryptionService; моки только края (auth-провайдер, мета в DataProvider, SyncService).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

const updateUserPassword = vi.hoisted(() => vi.fn());
const USER = 'user_d41b_recovery';

vi.mock('@/core/auth', () => ({
  getCurrentUser: () => ({ uid: USER, email: 'd41b@example.test' }),
  getCurrentUserId: () => USER,
  updateUserPassword,
}));
vi.mock('@/core/services/SyncService', () => ({
  SyncService: { reviveLockedTasks: vi.fn(async () => {}), syncPending: vi.fn(async () => {}) },
}));
vi.mock('@/shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { recoverVaultWithCode, lockVault } from '@/core/services/EncryptionService';
import {
  generateDataKey, deriveMasterKey, wrapDataKey, encryptContent, getSessionKey, PBKDF2_ITERATIONS,
} from '@/core/crypto/encrypt';
import { generateRecoveryCode, wrapDataKeyWithRecoveryCode } from '@/core/crypto/recoveryCode';
import { generateSalt, saltToBase64, VERIFICATION_PLAINTEXT } from '@/core/services/EncryptionMetaService';
import { setPendingLoginPassword, takePendingLoginPassword } from '@/core/crypto/pendingLoginPassword';
import { setProfileLoaded, setEncryptionEnabled } from '@/core/crypto/cryptoHelpers';
import { DataProvider } from '@/core/data';

let savedMeta: Record<string, unknown> | null = null;
let recoveryCode = '';
let originalSalt = '';

beforeEach(async () => {
  vi.clearAllMocks();
  setProfileLoaded(USER, true);
  setEncryptionEnabled(USER, false);
  lockVault(USER);

  const dataKey = await generateDataKey();
  const salt = generateSalt();
  const masterKey = await deriveMasterKey('oldPassword123', salt);
  const wrappedDataKey = await wrapDataKey(dataKey, masterKey);
  const verification = await encryptContent(VERIFICATION_PLAINTEXT, dataKey);
  recoveryCode = generateRecoveryCode();
  const rSalt = generateSalt();
  const recoveryWrappedDataKey = await wrapDataKeyWithRecoveryCode(dataKey, recoveryCode, rSalt);
  originalSalt = saltToBase64(salt);
  savedMeta = {
    salt: originalSalt,
    version: 2,
    wrappedDataKey,
    verification,
    iterations: PBKDF2_ITERATIONS,
    recoveryWrappedDataKey,
    recoverySalt: saltToBase64(rSalt),
  };

  vi.spyOn(DataProvider, 'getEncryptionMeta').mockImplementation(async () => (
    savedMeta ? { encryptionMeta: savedMeta } as never : null
  ));
  vi.spyOn(DataProvider, 'saveEncryptionMeta').mockImplementation(async (_uid: string, data: { encryptionMeta?: Record<string, unknown> }) => {
    savedMeta = data.encryptionMeta ?? null;
  });
  setPendingLoginPassword(USER, 'MARKER_DAILY_LOGIN_PASSWORD');
});

describe('d41b: отказ смены пароля входа при восстановлении сейфа назван, а не «восстановлено»', () => {
  it('updateUserPassword отказал — операция не объявляет успех (бросок или флаг)', async () => {
    updateUserPassword.mockRejectedValue(new Error('MARKER_DAILY_AUTH_PROVIDER_DOWN'));
    await expect(
      recoverVaultWithCode(USER, recoveryCode, 'newPassword123'),
      'отказ смены пароля входа проглочен — вызывающий покажет зелёное «восстановлено», а пароли разошлись',
    ).rejects.toThrow();
  }, 60_000);

  it('механизм лжи: pendingLoginPassword стёрт ДО отказа — повторное сведение при следующем входе невозможно', async () => {
    updateUserPassword.mockRejectedValue(new Error('MARKER_DAILY_AUTH_PROVIDER_DOWN'));
    await recoverVaultWithCode(USER, recoveryCode, 'newPassword123').catch(() => {});
    expect(updateUserPassword).toHaveBeenCalled();
    expect(
      takePendingLoginPassword(USER),
      'пароль входа стёрт, хотя смена не прошла — следующий вход не сведёт пароли',
    ).toBe('MARKER_DAILY_LOGIN_PASSWORD');
  }, 60_000);

  it('КОНТРОЛЬ: провайдер ответил — операция завершается, мета перевёрнута, ключ в сессии', async () => {
    updateUserPassword.mockResolvedValue(undefined);
    await recoverVaultWithCode(USER, recoveryCode, 'newPassword123');
    expect(updateUserPassword).toHaveBeenCalledWith('newPassword123');
    expect(getSessionKey()).not.toBeNull();
    expect((savedMeta as { salt?: string }).salt).not.toBe(originalSalt);
  }, 60_000);
});
