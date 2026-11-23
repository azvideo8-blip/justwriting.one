// NB-6 (sus03): «Запомнить на этом устройстве» — ключ не сохранился, а окно
// молчало и галочка оставалась снятой/стоявшей как ни в чём не бывало.
// Отказ saveDeviceKey (и null-ключ сессии) — галочка снята, флаг store снят,
// warning «сейф попросит пароль после перезагрузки».
// Мутации: убрать ветку else с warning/снятием галочки — красный; вернуть
// `if (key)` без обработки null — красный (второй случай).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { unlockVault, saveDeviceKey, clearDeviceKey, getSessionKey, setRememberDevice, showToast, refreshProfile } = vi.hoisted(() => ({
  unlockVault: vi.fn(),
  saveDeviceKey: vi.fn(),
  clearDeviceKey: vi.fn(),
  getSessionKey: vi.fn(),
  setRememberDevice: vi.fn(),
  showToast: vi.fn(),
  refreshProfile: vi.fn(),
}));

vi.mock('../../../../core/services/EncryptionService', () => ({
  unlockVault: (...a: unknown[]) => unlockVault(...a),
  initializeEncryption: vi.fn(),
  migrateNotesAfterSetup: vi.fn(),
  recoverVaultWithCode: vi.fn(),
  VaultAlreadyExistsError: class VaultAlreadyExistsError extends Error {},
  WrongPasswordError: class WrongPasswordError extends Error {},
  WrongRecoveryCodeError: class WrongRecoveryCodeError extends Error {},
  LoginPasswordNotUpdatedError: class LoginPasswordNotUpdatedError extends Error {},
}));
vi.mock('../../../../core/crypto/keyVaultCache', () => ({
  saveDeviceKey: (...a: unknown[]) => saveDeviceKey(...a),
  clearDeviceKey: (...a: unknown[]) => clearDeviceKey(...a),
}));
vi.mock('../../../../core/crypto/encrypt', async (orig) => ({
  ...(await orig<object>()),
  getSessionKey: () => getSessionKey(),
}));
vi.mock('../../../../core/crypto/useEncryptionStore', async (orig) => ({
  ...(await orig<object>()),
  setRememberDevice: (on: boolean) => setRememberDevice(on),
}));
vi.mock('../../../../core/services/EncryptionMetaService', async (orig) => ({
  ...(await orig<object>()),
  getEncryptionMeta: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'user-1' }, profile: null, refreshProfile }),
}));
vi.mock('../../../../core/auth', async (orig) => ({
  ...(await orig<object>()),
  getCurrentUser: () => ({ uid: 'user-1', email: 'user@example.com' }),
}));

import { EncryptionPasswordModal } from '../EncryptionPasswordModal';

async function unlockWithRemember() {
  const onDone = vi.fn();
  render(<EncryptionPasswordModal mode="unlock" userId="user-1" onDone={onDone} />);
  fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'password123' } });
  const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
  fireEvent.click(checkbox);
  expect(checkbox.checked).toBe(true);
  fireEvent.click(screen.getByText('enc_unlock_submit'));
  await waitFor(() => expect(unlockVault).toHaveBeenCalledWith('user-1', 'password123'));
  return { checkbox, onDone };
}

beforeEach(() => {
  vi.clearAllMocks();
  unlockVault.mockResolvedValue(undefined);
  clearDeviceKey.mockResolvedValue(undefined);
  saveDeviceKey.mockResolvedValue(true);
  getSessionKey.mockReturnValue({} as CryptoKey);
  refreshProfile.mockResolvedValue(undefined);
});

describe('NB-6: «запомнить устройство» — отказ назван', () => {
  it('saveDeviceKey отказал — галочка снята, флаг снят, warning, разблокировка не отменена', async () => {
    saveDeviceKey.mockResolvedValue(false);
    const { checkbox, onDone } = await unlockWithRemember();
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('enc_remember_device_failed', 'warning'));
    expect(checkbox.checked).toBe(false);
    expect(setRememberDevice).toHaveBeenCalledWith(false);
    expect(setRememberDevice).not.toHaveBeenCalledWith(true);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('ключа сессии нет (null) — та же обработка: галочка снята и warning', async () => {
    getSessionKey.mockReturnValue(null);
    const { checkbox } = await unlockWithRemember();
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('enc_remember_device_failed', 'warning'));
    expect(saveDeviceKey).not.toHaveBeenCalled();
    expect(checkbox.checked).toBe(false);
    expect(setRememberDevice).toHaveBeenCalledWith(false);
    expect(setRememberDevice).not.toHaveBeenCalledWith(true);
  });

  it('контроль: ключ сохранён — флаг стоит, галочка стоит, warning нет', async () => {
    const { checkbox } = await unlockWithRemember();
    await waitFor(() => expect(setRememberDevice).toHaveBeenCalledWith(true));
    expect(saveDeviceKey).toHaveBeenCalledWith('user-1', expect.anything());
    expect(checkbox.checked).toBe(true);
    expect(showToast).not.toHaveBeenCalledWith('enc_remember_device_failed', 'warning');
  });
});