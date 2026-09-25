// TEST-1 §1.3: the recovery link leads to a working password change.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { LanguageProvider } from '../../../../shared/i18n';
import { MemoryRouter } from 'react-router-dom';

const { onPasswordRecoveryCb, updateUserPassword, signOutUser, verifyOtpForRecovery, getCurrentUser, mockNavigate } = vi.hoisted(() => {
  let cb: () => void = () => {};
  return {
    onPasswordRecoveryCb: {
      register: (fn: () => void) => { cb = fn; },
      fire: () => cb(),
      reset: () => { cb = () => {}; },
    },
    updateUserPassword: vi.fn().mockResolvedValue(undefined),
    signOutUser: vi.fn().mockResolvedValue(undefined),
    verifyOtpForRecovery: vi.fn().mockResolvedValue(undefined),
    getCurrentUser: vi.fn().mockReturnValue(null),
    mockNavigate: vi.fn(),
  };
});

vi.mock('../../../../core/auth/supabaseAuthProvider', () => ({
  updateUserPassword: (...a: unknown[]) => updateUserPassword(...(a as [])),
  signOutUser: (...a: unknown[]) => signOutUser(...(a as [])),
  onPasswordRecovery: (fn: () => void) => { onPasswordRecoveryCb.register(fn); return () => {}; },
  verifyOtpForRecovery: (...a: unknown[]) => verifyOtpForRecovery(...(a as [])),
  getCurrentUser: (...a: unknown[]) => getCurrentUser(...(a as [])),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

import { ResetPasswordPage } from '../ResetPasswordPage';

function renderPage(initialEntries = ['/']) {
  return render(<LanguageProvider><MemoryRouter initialEntries={initialEntries}><ResetPasswordPage /></MemoryRouter></LanguageProvider>);
}

beforeEach(() => {
  updateUserPassword.mockClear();
  signOutUser.mockClear();
  verifyOtpForRecovery.mockClear();
  getCurrentUser.mockClear();
  mockNavigate.mockClear();
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

  it('token_hash and type=recovery in URL calls verifyOtp and reveals form on success', async () => {
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    renderPage(['/reset-password?token_hash=abc123hash&type=recovery']);

    await waitFor(() => {
      expect(verifyOtpForRecovery).toHaveBeenCalledWith('abc123hash', 'recovery');
    });

    const pwInputs = await screen.findAllByPlaceholderText(/Новый пароль|Повторите пароль/);
    expect(pwInputs).toHaveLength(2);
    expect(replaceSpy).toHaveBeenCalledWith(null, '', expect.any(String));
    replaceSpy.mockRestore();
  });

  it('token_hash and type=invite calls verifyOtp with invite and titles the page «Задайте пароль»', async () => {
    renderPage(['/reset-password?token_hash=inv123&type=invite']);
    await waitFor(() => {
      expect(verifyOtpForRecovery).toHaveBeenCalledWith('inv123', 'invite');
    });
    // ON-2: приглашённый попадает в мастер, а не в голую форму.
    expect(await screen.findByText('Добро пожаловать в justwriting')).toBeTruthy();
  });

  it('verifyOtp rejection shows expired link error and request-again button', async () => {
    verifyOtpForRecovery.mockRejectedValueOnce(new Error('Email link is invalid or has expired'));
    renderPage(['/reset-password?token_hash=expired-token&type=recovery']);

    expect(await screen.findByText('Ссылка уже использована или устарела — запросите новую')).toBeTruthy();
    expect(screen.getByText('Запросить новую ссылку')).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Новый пароль/)).toBeNull();
  });

  it('legacy access_token hash displays legacy warning and hides password form even if signed in', async () => {
    getCurrentUser.mockReturnValue({ uid: 'signed_in_user_1', email: 'user@example.com' });
    const originalHash = window.location.hash;
    window.location.hash = '#access_token=legacy123&type=recovery';

    try {
      renderPage(['/reset-password#access_token=legacy123&type=recovery']);
      expect(screen.getByText(/Ссылка из письма имеет устаревший формат/)).toBeTruthy();
      expect(screen.queryByPlaceholderText(/Новый пароль/)).toBeNull();
    } finally {
      window.location.hash = originalHash;
    }
  });
});
