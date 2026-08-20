import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AccountVaultSection } from '../AccountVaultSection';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k }),
}));

vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

const generateRecoveryCodeForExistingVault = vi.fn();

vi.mock('../../../../core/services/EncryptionService', () => ({
  EncryptionService: {
    generateRecoveryCodeForExistingVault: (...args: unknown[]) => generateRecoveryCodeForExistingVault(...args),
    initializeEncryption: vi.fn(),
    lockVault: vi.fn(),
    encryptAll: vi.fn(),
    VaultAlreadyExistsError: class VaultAlreadyExistsError extends Error {},
    KeyNotExtractableError: class KeyNotExtractableError extends Error {},
  },
  WrongPasswordError: class WrongPasswordError extends Error {},
  hasVault: () => true,
}));

vi.mock('../../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: (selector: (s: { isVaultUnlocked: boolean }) => unknown) => selector({ isVaultUnlocked: true }),
  setRememberDevice: vi.fn(),
}));

vi.mock('../../../../core/crypto/encrypt', () => ({
  // Извлекаемый ключ: путь без запроса пароля.
  getSessionKey: () => ({ extractable: true }),
}));

vi.mock('../../../../core/crypto/keyVaultCache', () => ({ clearDeviceKey: vi.fn() }));

vi.mock('../../../../app/EncryptionPasswordModal', () => ({
  ChangeEncryptionPasswordButton: () => null,
  EncryptionPasswordModal: () => null,
}));

const profileWithRecovery = {
  uid: 'u1',
  encryptionMeta: {
    salt: 'c2FsdA==',
    version: 2,
    wrappedDataKey: 'd3JhcHBlZA==',
    verification: 'dmVyaWZ5',
    recoveryWrappedDataKey: 'cmVjb3Zlcnk=',
    recoverySalt: 'cmVjb3ZlcnlTYWx0',
  },
};

vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ profile: profileWithRecovery, refreshProfile: vi.fn() }),
}));

// Новый код молча отменял прежний: перезапись `recoveryWrappedDataKey` без
// единого слова об этом. Человек, у которого плашка «код не создан» висела
// из-за бага показа, нажимал кнопку несколько раз и обесценивал сохранённые
// коды, не зная об этом.
describe('AccountVaultSection: замена кода восстановления', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateRecoveryCodeForExistingVault.mockResolvedValue('ABCD-EFGH-IJKL-MNOP-QRST-UVWX');
  });

  it('у сейфа с кодом показывает состояние, а не приглашение создать', () => {
    render(<AccountVaultSection userId="u1" />);
    expect(screen.getByText('enc_recovery_code_present_title')).toBeTruthy();
    expect(screen.queryByText('enc_recovery_code_missing_title')).toBeNull();
  });

  it('не создаёт новый код без подтверждения', () => {
    render(<AccountVaultSection userId="u1" />);

    fireEvent.click(screen.getByText('enc_regenerate_recovery_code_btn'));

    expect(screen.getByText('enc_regenerate_recovery_confirm_title')).toBeTruthy();
    expect(generateRecoveryCodeForExistingVault).not.toHaveBeenCalled();
  });

  it('создаёт новый код после подтверждения и показывает его', async () => {
    render(<AccountVaultSection userId="u1" />);

    fireEvent.click(screen.getByText('enc_regenerate_recovery_code_btn'));
    fireEvent.click(screen.getByText('enc_regenerate_recovery_confirm_btn'));

    await waitFor(() => {
      expect(generateRecoveryCodeForExistingVault).toHaveBeenCalledWith('u1');
    });
    await waitFor(() => {
      expect(screen.getByText('ABCD-EFGH-IJKL-MNOP-QRST-UVWX')).toBeTruthy();
    });
  });
});
