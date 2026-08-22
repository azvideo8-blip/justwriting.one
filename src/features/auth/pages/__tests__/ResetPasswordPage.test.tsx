// TEST-1 §1.3: the recovery link leads to a working password change.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { onPasswordRecoveryCb, updateUserPassword, signOutUser } = vi.hoisted(() => {
  let cb: () => void = () => {};
  return {
    onPasswordRecoveryCb: {
      register: (fn: () => void) => { cb = fn; },
      fire: () => cb(),
      reset: () => { cb = () => {}; },
    },
    updateUserPassword: vi.fn().mockResolvedValue(undefined),
    signOutUser: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../../../core/auth/supabaseAuthProvider', () => ({
  updateUserPassword: (...a: unknown[]) => updateUserPassword(...(a as [])),
  signOutUser: (...a: unknown[]) => signOutUser(...(a as [])),
  onPasswordRecovery: (fn: () => void) => { onPasswordRecoveryCb.register(fn); return () => {}; },
}));

import { ResetPasswordPage } from '../ResetPasswordPage';

function renderPage() {
  return render(<MemoryRouter><ResetPasswordPage /></MemoryRouter>);
}

beforeEach(() => {
  updateUserPassword.mockClear();
  signOutUser.mockClear();
  onPasswordRecoveryCb.reset();
});

describe('1.3 password recovery', () => {
  it('PASSWORD_RECOVERY reveals the form; submit changes the password and signs out the half-session', async () => {
    renderPage();

    // Before the event there is no form — only the hint.
    expect(screen.queryByDisplayValue('')).toBeNull();

    act(() => { onPasswordRecoveryCb.fire(); });

    const pwInputs = screen.getAllByPlaceholderText(/Новый пароль|Повторите пароль/);
    expect(pwInputs).toHaveLength(2);
    fireEvent.change(pwInputs[0]!, { target: { value: 'new-secret-9' } });
    fireEvent.change(pwInputs[1]!, { target: { value: 'new-secret-9' } });

    fireEvent.click(screen.getByText('Сменить пароль'));

    await waitFor(() => expect(updateUserPassword).toHaveBeenCalledWith('new-secret-9'));
    // The recovery half-session is terminated on purpose.
    expect(signOutUser).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Пароль изменён/)).toBeTruthy();
  });

  it('mismatched confirmation blocks the submit', async () => {
    renderPage();
    act(() => { onPasswordRecoveryCb.fire(); });

    const pwInputs = screen.getAllByPlaceholderText(/Новый пароль|Повторите пароль/);
    fireEvent.change(pwInputs[0]!, { target: { value: 'aaaa1111' } });
    fireEvent.change(pwInputs[1]!, { target: { value: 'bbbb2222' } });
    fireEvent.click(screen.getByText('Сменить пароль'));

    expect(await screen.findByText('Пароли не совпадают')).toBeTruthy();
    expect(updateUserPassword).not.toHaveBeenCalled();
  });
});
