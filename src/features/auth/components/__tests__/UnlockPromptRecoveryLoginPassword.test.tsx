// FN-2 (дейлик 20.11, Н-2): код восстановления перевернул сейф, но пароль входа
// не обновился — окно называет это честным текстом, а не «Сейф восстановлен».
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const recoverVaultWithCode = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());
const { WrongRecoveryCodeError, LoginPasswordNotUpdatedError } = vi.hoisted(() => ({
  WrongRecoveryCodeError: class WrongRecoveryCodeError extends Error {},
  LoginPasswordNotUpdatedError: class LoginPasswordNotUpdatedError extends Error {},
}));

vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({ useLayoutMode: () => ({ layoutMode: 'desktop' }) }));
vi.mock('../../../../core/services/EncryptionService', () => ({
  unlockVault: vi.fn(),
  recoverVaultWithCode: (...a: unknown[]) => recoverVaultWithCode(...a),
  WrongPasswordError: class WrongPasswordError extends Error {},
  WrongRecoveryCodeError,
  LoginPasswordNotUpdatedError,
}));

import { UnlockPrompt } from '../UnlockPrompt';

async function submitRecovery(onUnlocked = vi.fn()) {
  render(<UnlockPrompt uid="u1" onUnlocked={onUnlocked} onClose={vi.fn()} />);
  fireEvent.click(screen.getByText('enc_recovery_link'));
  fireEvent.change(screen.getByLabelText('enc_recovery_code_label'), { target: { value: 'ABCD-EFGH' } });
  fireEvent.change(screen.getByLabelText('enc_recovery_new_password'), { target: { value: 'password123' } });
  fireEvent.change(screen.getByLabelText('enc_recovery_confirm_password'), { target: { value: 'password123' } });
  fireEvent.click(screen.getByText('enc_recovery_submit'));
  return onUnlocked;
}

describe('UnlockPrompt: восстановление кодом, итог назван', () => {
  beforeEach(() => { cleanup(); vi.clearAllMocks(); });

  // Ревью FN-2: сейф к этому моменту уже открыт — окно закрывается (onUnlocked), итог —
  // предупреждение, а не зелёное «восстановлен» и не ошибка в незакрывающемся окне.
  it('пароль входа не обновился — предупреждение, без «Доступ восстановлен», окно закрывается', async () => {
    recoverVaultWithCode.mockRejectedValue(new LoginPasswordNotUpdatedError());
    const onUnlocked = await submitRecovery();
    await waitFor(() => expect(onUnlocked).toHaveBeenCalled());
    expect(showToast).toHaveBeenCalledWith('enc_recovery_login_password_failed', 'warning');
    expect(showToast).not.toHaveBeenCalledWith('enc_recovery_success', 'success');
  });

  it('КОНТРОЛЬ: успех — зелёный «Доступ восстановлен» и onUnlocked', async () => {
    recoverVaultWithCode.mockResolvedValue(undefined);
    const onUnlocked = await submitRecovery();
    await waitFor(() => expect(onUnlocked).toHaveBeenCalled());
    expect(showToast).toHaveBeenCalledWith('enc_recovery_success', 'success');
  });
});
