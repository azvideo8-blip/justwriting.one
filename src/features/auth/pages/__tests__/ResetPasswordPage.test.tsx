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

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn().mockResolvedValue({ data: { session: null } }) }));
vi.mock('../../../../core/supabase/client', () => ({
  getSupabase: () => ({ auth: { getSession: (...a: unknown[]) => getSession(...(a as [])) } }),
}));

const { reloadForAccountChange } = vi.hoisted(() => ({ reloadForAccountChange: vi.fn() }));
vi.mock('../../../../core/auth/accountReload', () => ({
  reloadForAccountChange: () => reloadForAccountChange(),
  isAccountReloadPending: () => false,
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
  sessionStorage.clear();
  updateUserPassword.mockClear();
  signOutUser.mockClear();
  verifyOtpForRecovery.mockClear();
  getCurrentUser.mockClear();
  mockNavigate.mockClear();
  reloadForAccountChange.mockClear();
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

// Ссылка-приглашение поверх уже открытого аккаунта: сессия в браузере одна, и
// переход молча выкидывал человека из его аккаунта (а его черновик уезжал в новый).
describe('invite link while another account is signed in', () => {
  it('asks first, verifies nothing until the person agrees', async () => {
    getSession.mockResolvedValueOnce({ data: { session: { user: { email: 'owner@example.com' } } } });
    renderPage(['/reset-password?token_hash=abc&type=invite']);

    expect(await screen.findByTestId('invite-switch-account')).toBeInTheDocument();
    expect(screen.getByText('owner@example.com')).toBeInTheDocument();
    expect(verifyOtpForRecovery).not.toHaveBeenCalled();
    // N-56: для скринридера это диалог с названием, фокус — на безопасном «Остаться».
    expect(screen.getByRole('alertdialog', { name: /вход в другой аккаунт/i })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByText('Остаться'));

    // «Продолжить»: сначала выход из прежнего аккаунта и перезагрузка —
    // ссылка обменивается уже на чистой странице.
    getSession.mockResolvedValueOnce({ data: { session: { user: { email: 'owner@example.com' } } } });
    fireEvent.click(screen.getByText('Продолжить'));
    await waitFor(() => expect(signOutUser).toHaveBeenCalledWith({ scope: 'local' }));
    await waitFor(() => expect(reloadForAccountChange).toHaveBeenCalled());
    expect(verifyOtpForRecovery).not.toHaveBeenCalled();
  });

  it('«Остаться» leaves the link unused and returns to the app', async () => {
    getSession.mockResolvedValueOnce({ data: { session: { user: { email: 'owner@example.com' } } } });
    renderPage(['/reset-password?token_hash=abc&type=invite']);
    fireEvent.click(await screen.findByText('Остаться'));
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    expect(verifyOtpForRecovery).not.toHaveBeenCalled();
  });

  // N-37: сбой проверки сессии — не «никто не вошёл»: приглашение не меняет аккаунт без вопроса.
  it('when the session check fails, it still asks instead of switching silently', async () => {
    getSession.mockRejectedValueOnce(new Error('storage unavailable'));
    renderPage(['/reset-password?token_hash=abc&type=invite']);
    expect(await screen.findByTestId('invite-switch-account')).toBeInTheDocument();
    expect(verifyOtpForRecovery).not.toHaveBeenCalled();
  });

  // N-57: поля пароля различимы без placeholder'а, ошибка объявляется.
  it('password fields have labels and the mismatch error is announced', async () => {
    renderPage();
    act(() => { onPasswordRecoveryCb.fire(); });
    fireEvent.change(screen.getByLabelText('Новый пароль'), { target: { value: 'aaaaaaaaaa' } });
    fireEvent.change(screen.getByLabelText('Повторите пароль'), { target: { value: 'bbbbbbbbbb' } });
    fireEvent.click(screen.getByText('Сменить пароль'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  // Путь целиком, со сменой аккаунта через перезагрузку: вопрос — выход —
  // чистая страница обменивает ссылку — перезагрузка посреди мастера не
  // спрашивает снова и не обменивает второй раз («ссылка устарела»).
  it('continue → sign-out and reload → exchange on a clean page → a later reload neither asks nor exchanges again', async () => {
    const url = ['/reset-password?token_hash=tok-reload&type=invite'];
    getSession.mockResolvedValue({ data: { session: { user: { email: 'owner@example.com' } } } });
    const first = renderPage(url);
    fireEvent.click(await screen.findByText('Продолжить'));
    await waitFor(() => expect(reloadForAccountChange).toHaveBeenCalled());
    expect(verifyOtpForRecovery).not.toHaveBeenCalled();
    first.unmount();

    getSession.mockResolvedValue({ data: { session: null } });
    const second = renderPage(url);
    await waitFor(() => expect(verifyOtpForRecovery).toHaveBeenCalledWith('tok-reload', 'invite'));
    expect(screen.queryByTestId('invite-switch-account')).toBeNull();
    second.unmount();

    verifyOtpForRecovery.mockClear();
    getSession.mockResolvedValue({ data: { session: { user: { email: 'invitee@example.com' } } } });
    renderPage(url);
    await waitFor(() => expect(getSession).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(verifyOtpForRecovery).not.toHaveBeenCalled();
    expect(screen.queryByTestId('invite-switch-account')).toBeNull();
    expect(signOutUser).toHaveBeenCalledTimes(1);
    getSession.mockResolvedValue({ data: { session: null } });
  });

  it('«password changed» survives the reload that the sign-out after it causes', async () => {
    const before = renderPage();
    act(() => { onPasswordRecoveryCb.fire(); });
    fireEvent.change(screen.getByLabelText('Новый пароль'), { target: { value: 'new-secret-9' } });
    fireEvent.change(screen.getByLabelText('Повторите пароль'), { target: { value: 'new-secret-9' } });
    getCurrentUser.mockReturnValue({ uid: 'u1', email: 'me@example.com' });
    fireEvent.click(screen.getByText('Сменить пароль'));
    await waitFor(() => expect(signOutUser).toHaveBeenCalled());
    getCurrentUser.mockReturnValue(null);
    before.unmount(); // страница перезагрузилась
    const { unmount } = renderPage(['/reset-password']);
    expect(screen.getAllByText(/Пароль изменён/).length).toBeGreaterThan(0);
    unmount();
  });
});
