// PIN-1 (дейлик 20.11): окно «Разблокировать» — неверный пароль и прочий отказ названы в окне,
// без «разблокировано». Мутации: убрать ветку WrongPasswordError (показывает общую ошибку);
// убрать ветку else (общая ошибка не показывается).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const h = vi.hoisted(() => ({ unlockVault: vi.fn(), showToast: vi.fn() }));
const { WrongPasswordError, WrongRecoveryCodeError, LoginPasswordNotUpdatedError } = vi.hoisted(() => ({
  WrongPasswordError: class WrongPasswordError extends Error {},
  WrongRecoveryCodeError: class WrongRecoveryCodeError extends Error {},
  LoginPasswordNotUpdatedError: class LoginPasswordNotUpdatedError extends Error {},
}));

vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: h.showToast }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({ useLayoutMode: () => ({ layoutMode: 'desktop' }) }));
vi.mock('../../../../core/services/EncryptionService', () => ({
  unlockVault: (...a: unknown[]) => h.unlockVault(...a),
  recoverVaultWithCode: vi.fn(),
  WrongPasswordError,
  WrongRecoveryCodeError,
  LoginPasswordNotUpdatedError,
}));

import { UnlockPrompt } from '../UnlockPrompt';

async function submit(onUnlocked = vi.fn()) {
  render(<UnlockPrompt uid="u1" onUnlocked={onUnlocked} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('unlock_title', { selector: 'input' }), { target: { value: 'pass-1234' } });
  fireEvent.click(screen.getByRole('button', { name: 'unlock_submit' }));
  return onUnlocked;
}

describe('PIN-1: UnlockPrompt — итог разблокировки', () => {
  beforeEach(() => { cleanup(); vi.clearAllMocks(); });

  it('неверный пароль — inline «неверный пароль», без «разблокировано» и onUnlocked', async () => {
    h.unlockVault.mockRejectedValue(new WrongPasswordError());
    const onUnlocked = await submit();
    await waitFor(() => expect(screen.getByText('unlock_wrong_password')).toBeTruthy());
    expect(h.showToast).not.toHaveBeenCalledWith('unlock_success', 'success');
    expect(onUnlocked).not.toHaveBeenCalled();
  });

  it('прочий отказ — inline общая ошибка, не «неверный пароль»', async () => {
    h.unlockVault.mockRejectedValue(new Error('MARKER_PIN1_IDB'));
    const onUnlocked = await submit();
    await waitFor(() => expect(screen.getByText('error_generic')).toBeTruthy());
    expect(screen.queryByText('unlock_wrong_password')).toBeNull();
    expect(onUnlocked).not.toHaveBeenCalled();
  });

  it('КОНТРОЛЬ: верный пароль — «разблокировано» и onUnlocked', async () => {
    h.unlockVault.mockResolvedValue(undefined);
    const onUnlocked = await submit();
    await waitFor(() => expect(onUnlocked).toHaveBeenCalled());
    expect(h.showToast).toHaveBeenCalledWith('unlock_success', 'success');
  });
});
