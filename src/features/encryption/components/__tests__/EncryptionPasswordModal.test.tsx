import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EncryptionPasswordModal } from '../EncryptionPasswordModal';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k }),
}));

vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'u1' }, profile: null }),
}));

const initializeEncryption = vi.fn();

vi.mock('../../../../core/services/EncryptionService', () => ({
  initializeEncryption: (...args: unknown[]) => initializeEncryption(...args),
  unlockVault: vi.fn(),
  recoverVaultWithCode: vi.fn(),
  changePassword: vi.fn(),
  VaultAlreadyExistsError: class VaultAlreadyExistsError extends Error {},
  WrongPasswordError: class WrongPasswordError extends Error {},
  WrongRecoveryCodeError: class WrongRecoveryCodeError extends Error {},
}));

// Сейф, заведённый из этого окна, раньше получал код восстановления, которого
// не видел никто: `handleSetup` вызывал `initializeEncryption` и выбрасывал
// возвращённый код.
describe('EncryptionPasswordModal, режим создания сейфа', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initializeEncryption.mockResolvedValue({ recoveryCode: 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX' });
  });

  const submitSetup = () => {
    const fields = screen.getAllByPlaceholderText(/enc_new_password_placeholder|enc_confirm_password/);
    expect(fields).toHaveLength(2);
    for (const field of fields) {
      fireEvent.change(field, { target: { value: 'password123' } });
    }
    fireEvent.click(screen.getByText('enc_setup_submit'));
  };

  it('показывает код восстановления и не зовёт onDone, пока не отмечена галочка', async () => {
    const onDone = vi.fn();
    render(<EncryptionPasswordModal mode="setup" userId="u1" onDone={onDone} />);

    submitSetup();

    await waitFor(() => {
      expect(screen.getByText('ABCD-EFGH-IJKL-MNOP-QRST-UVWX')).toBeTruthy();
    });
    expect(initializeEncryption).toHaveBeenCalledWith('u1', 'password123');
    expect(onDone).not.toHaveBeenCalled();

    // Кнопка «Продолжить» неактивна, пока человек не подтвердил, что сохранил код.
    const continueBtn = screen.getByText('enc_recovery_code_continue_btn').closest('button');
    expect(continueBtn?.disabled).toBe(true);
  });

  it('зовёт onDone только после подтверждения', async () => {
    const onDone = vi.fn();
    render(<EncryptionPasswordModal mode="setup" userId="u1" onDone={onDone} />);

    submitSetup();
    await waitFor(() => expect(screen.getByText('ABCD-EFGH-IJKL-MNOP-QRST-UVWX')).toBeTruthy());

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('enc_recovery_code_continue_btn'));

    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
