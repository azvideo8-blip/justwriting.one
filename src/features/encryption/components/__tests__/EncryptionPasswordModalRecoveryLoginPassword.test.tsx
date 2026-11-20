// Ревью FN-2, второй вход: окно пароля сейфа (режим unlock → «Забыл пароль»). Код
// восстановления перевернул сейф, пароль входа не сменился — сейф уже открыт: окно
// закрывается (onDone), итог — предупреждение, не зелёное «восстановлен» и не ошибка.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const recoverVaultWithCode = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());
const { LoginPasswordNotUpdatedError } = vi.hoisted(() => ({
  LoginPasswordNotUpdatedError: class LoginPasswordNotUpdatedError extends Error {},
}));

vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'u1' }, profile: null, refreshProfile: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock('../../../../core/services/EncryptionService', () => ({
  initializeEncryption: vi.fn(), migrateNotesAfterSetup: vi.fn(), unlockVault: vi.fn(), changePassword: vi.fn(),
  recoverVaultWithCode: (...a: unknown[]) => recoverVaultWithCode(...a),
  VaultAlreadyExistsError: class VaultAlreadyExistsError extends Error {},
  WrongPasswordError: class WrongPasswordError extends Error {},
  WrongRecoveryCodeError: class WrongRecoveryCodeError extends Error {},
  LoginPasswordNotUpdatedError,
}));

import { EncryptionPasswordModal } from '../EncryptionPasswordModal';

async function submitRecovery() {
  const onDone = vi.fn();
  render(<EncryptionPasswordModal mode="unlock" userId="u1" onDone={onDone} />);
  fireEvent.click(screen.getByText('enc_recovery_link'));
  fireEvent.change(screen.getByLabelText('enc_recovery_code_label'), { target: { value: 'ABCD-EFGH' } });
  fireEvent.change(screen.getByLabelText('enc_new_password_placeholder'), { target: { value: 'password123' } });
  fireEvent.change(screen.getByLabelText('enc_confirm_password'), { target: { value: 'password123' } });
  fireEvent.click(screen.getByText('enc_recovery_submit'));
  return onDone;
}

describe('EncryptionPasswordModal: восстановление кодом, пароль входа не сменился', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('предупреждение и окно закрывается', async () => {
    recoverVaultWithCode.mockRejectedValue(new LoginPasswordNotUpdatedError());
    const onDone = await submitRecovery();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(showToast).toHaveBeenCalledWith('enc_recovery_login_password_failed', 'warning');
    expect(showToast).not.toHaveBeenCalledWith('enc_recovery_success', 'success');
  });

  it('КОНТРОЛЬ: успех — зелёный «восстановлен»', async () => {
    recoverVaultWithCode.mockResolvedValue(undefined);
    const onDone = await submitRecovery();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(showToast).toHaveBeenCalledWith('enc_recovery_success', 'success');
  });
});
