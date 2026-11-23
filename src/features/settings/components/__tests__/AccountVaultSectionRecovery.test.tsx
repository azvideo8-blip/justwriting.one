import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AccountVaultSection } from '../AccountVaultSection';

// D-28: сейф создаётся только из пароля от аккаунта — проверка идёт повторным входом.
const reauthenticate = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../../core/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../core/auth')>()),
  getCurrentUser: () => ({ uid: 'user-1', email: 'user@example.com' }),
  reauthenticate: (...a: unknown[]) => reauthenticate(...a),
}));

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k }),
}));

const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn(async () => false) }));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}));

vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

const generateRecoveryCodeForExistingVault = vi.fn();
const initializeEncryption = vi.fn();
const migrateNotesAfterSetup = vi.fn().mockResolvedValue({ encrypted: 0, total: 0, errors: 0, success: true });
const mockShowToast = vi.fn();

vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

const hasVaultMock = vi.fn(() => true);

vi.mock('../../../../core/services/EncryptionService', () => ({
  EncryptionService: {
    generateRecoveryCodeForExistingVault: (...args: unknown[]) => generateRecoveryCodeForExistingVault(...args),
    initializeEncryption: (...args: unknown[]) => initializeEncryption(...args),
    migrateNotesAfterSetup: (...args: unknown[]) => migrateNotesAfterSetup(...args),
    lockVault: vi.fn(),
    encryptAll: vi.fn(),
    VaultAlreadyExistsError: class VaultAlreadyExistsError extends Error {},
    KeyNotExtractableError: class KeyNotExtractableError extends Error {},
  },
  WrongPasswordError: class WrongPasswordError extends Error {},
  hasVault: () => hasVaultMock(),
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

  it('не создаёт новый код без подтверждения', async () => {
    confirmMock.mockResolvedValueOnce(false);
    render(<AccountVaultSection userId="u1" />);

    fireEvent.click(screen.getByText('enc_regenerate_recovery_code_btn'));

    await waitFor(() => expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'enc_regenerate_recovery_confirm_title' })));
    expect(generateRecoveryCodeForExistingVault).not.toHaveBeenCalled();
  });

  it('создаёт новый код после подтверждения и показывает его', async () => {
    confirmMock.mockResolvedValueOnce(true);
    render(<AccountVaultSection userId="u1" />);

    fireEvent.click(screen.getByText('enc_regenerate_recovery_code_btn'));

    await waitFor(() => {
      expect(generateRecoveryCodeForExistingVault).toHaveBeenCalledWith('u1');
    });
    await waitFor(() => {
      expect(screen.getByText('ABCD-EFGH-IJKL-MNOP-QRST-UVWX')).toBeTruthy();
    });
  });

  it('при настройке сейфа запускает шифрование существующих заметок', async () => {
    hasVaultMock.mockReturnValue(false);
    initializeEncryption.mockResolvedValueOnce({ recoveryCode: 'INIT-RECV-CODE-1234' });
    migrateNotesAfterSetup.mockResolvedValueOnce({ encrypted: 4, total: 4, errors: 0, success: true });

    render(<AccountVaultSection userId="u1" />);

    const inputs = screen.getAllByPlaceholderText(/settings_initialize_password|settings_initialize_confirm/);
    expect(inputs).toHaveLength(2);
    fireEvent.change(inputs[0]!, { target: { value: 'password123' } });
    fireEvent.change(inputs[1]!, { target: { value: 'password123' } });

    fireEvent.click(screen.getByText('settings_initialize_submit'));

    await waitFor(() => {
      expect(initializeEncryption).toHaveBeenCalledWith('u1', 'password123');
      expect(migrateNotesAfterSetup).toHaveBeenCalledWith('u1');
      expect(mockShowToast).toHaveBeenCalledWith('settings_encrypt_done', 'success');
    });
  });

  it('PIN-1: настройка сейфа с ошибками шифрования — error settings_encrypt_partial, не успех', async () => {
    hasVaultMock.mockReturnValue(false);
    initializeEncryption.mockResolvedValueOnce({ recoveryCode: 'INIT-RECV-CODE-5678' });
    migrateNotesAfterSetup.mockResolvedValueOnce({ encrypted: 3, total: 5, errors: 2, success: false });

    render(<AccountVaultSection userId="u1" />);
    const inputs = screen.getAllByPlaceholderText(/settings_initialize_password|settings_initialize_confirm/);
    fireEvent.change(inputs[0]!, { target: { value: 'password123' } });
    fireEvent.change(inputs[1]!, { target: { value: 'password123' } });
    fireEvent.click(screen.getByText('settings_initialize_submit'));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('settings_encrypt_partial', 'error');
    });
    expect(mockShowToast).not.toHaveBeenCalledWith('settings_encrypt_done', 'success');
    expect(mockShowToast).not.toHaveBeenCalledWith('unlock_success', 'success');
  });

  it('PIN-1: encryptAll с ошибками — итог не зелёный, строка остановки видна', async () => {
    hasVaultMock.mockReturnValue(true);
    const { EncryptionService } = await import('../../../../core/services/EncryptionService');
    vi.mocked(EncryptionService.encryptAll).mockResolvedValueOnce({ total: 5, processed: 5, encrypted: 3, errors: 2, incomplete: true });

    render(<AccountVaultSection userId="u1" />);
    fireEvent.click(screen.getByText('settings_encrypt_all'));

    const done = await screen.findByText('settings_encrypt_done');
    expect(done.className).not.toContain('text-accent-success');
    expect(screen.getByText('settings_encrypt_budget_stop')).toBeTruthy();
  });

  it('PIN-1 контроль: encryptAll без ошибок — зелёный итог как раньше', async () => {
    hasVaultMock.mockReturnValue(true);
    const { EncryptionService } = await import('../../../../core/services/EncryptionService');
    vi.mocked(EncryptionService.encryptAll).mockResolvedValueOnce({ total: 4, processed: 4, encrypted: 4, errors: 0 });

    render(<AccountVaultSection userId="u1" />);
    fireEvent.click(screen.getByText('settings_encrypt_all'));

    const done = await screen.findByText('settings_encrypt_done');
    expect(done.className).toContain('text-accent-success');
    expect(screen.queryByText('settings_encrypt_budget_stop')).toBeNull();
  });
});
