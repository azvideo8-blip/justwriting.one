// TEST-1 §1.3: the recovery link leads to a working password change.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { StrictMode } from 'react';
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
  localStorage.clear();
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

    const pwInputs = screen.getAllByPlaceholderText(/Новый пароль|Повтори пароль/);
    expect(pwInputs).toHaveLength(2);
    fireEvent.change(pwInputs[0]!, { target: { value: 'new-secret-9' } });
    fireEvent.change(pwInputs[1]!, { target: { value: 'new-secret-9' } });

    fireEvent.click(screen.getByText('Сменить пароль'));

    await waitFor(() => expect(updateUserPassword).toHaveBeenCalledWith('new-secret-9'));
    // The recovery half-session is terminated on purpose.
    expect(signOutUser).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Пароль изменён/)).toBeTruthy();
  });

  // Эффект запускается повторно, пока обмен ещё в пути (StrictMode в разработке,
  // смена зависимостей на проде). Отметка «обменена», поставленная ДО обмена,
  // читалась вторым запуском как «обменена, а сессии нет» → «ссылка устарела».
  it('a second run of the effect during the exchange does not declare the link expired', async () => {
    let finish: (email: string) => void = () => {};
    verifyOtpForRecovery.mockImplementationOnce(() => new Promise(r => { finish = r as (email: string) => void; }));
    // «Ссылка устарела» хоть на миг — это чистка адреса и перемонтирование мастера.
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    render(<StrictMode><LanguageProvider><MemoryRouter initialEntries={['/reset-password?token_hash=strict-1&type=recovery']}><ResetPasswordPage /></MemoryRouter></LanguageProvider></StrictMode>);
    await waitFor(() => expect(verifyOtpForRecovery).toHaveBeenCalled());
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    await act(async () => { finish('me@example.com'); await Promise.resolve(); });
    expect(await screen.findAllByPlaceholderText(/Новый пароль|Повтори пароль/)).toHaveLength(2);
    expect(screen.queryByText(/устарела/i)).toBeNull();
    expect(replaceSpy).not.toHaveBeenCalled();
    replaceSpy.mockRestore();
  });

  it('mismatched confirmation blocks the submit', async () => {
    renderPage();
    act(() => { onPasswordRecoveryCb.fire(); });

    const pwInputs = screen.getAllByPlaceholderText(/Новый пароль|Повтори пароль/);
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

    const pwInputs = await screen.findAllByPlaceholderText(/Новый пароль|Повтори пароль/);
    expect(pwInputs).toHaveLength(2);
    // Адрес не чистится: обменянный token_hash второй раз не сработает, а после
    // перезагрузки по нему страница узнаёт «ссылка уже обменена» (F-3, 3b).
    expect(replaceSpy).not.toHaveBeenCalled();
    replaceSpy.mockRestore();
  });

  it('token_hash and type=invite calls verifyOtp with invite and titles the page «Задай пароль»', async () => {
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

    expect(await screen.findByText('Ссылка уже использована или устарела — запроси новую')).toBeTruthy();
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

  // До выхода и перезагрузки мастер приглашения не открывается прежнему
  // аккаунту: раньше он на миг показывался с его адресом, и клик сбрасывался.
  it('after «Continue» the previous account never sees the invite wizard', async () => {
    getCurrentUser.mockReturnValue({ uid: 'owner', email: 'owner@example.com' });
    getSession.mockResolvedValue({ data: { session: { user: { email: 'owner@example.com' } } } });
    renderPage(['/reset-password?token_hash=pending-1&type=invite']);
    fireEvent.click(await screen.findByText('Продолжить'));
    await waitFor(() => expect(reloadForAccountChange).toHaveBeenCalled());
    expect(screen.queryByText('Начать')).toBeNull();
    expect(screen.queryByText('owner@example.com')).toBeNull();
    getCurrentUser.mockReturnValue(null);
    getSession.mockResolvedValue({ data: { session: null } });
  });

  it('«Остаться» leaves the link unused and returns to the app', async () => {
    getSession.mockResolvedValueOnce({ data: { session: { user: { email: 'owner@example.com' } } } });
    renderPage(['/reset-password?token_hash=abc&type=invite']);
    fireEvent.click(await screen.findByText('Остаться'));
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    expect(verifyOtpForRecovery).not.toHaveBeenCalled();
  });

  // N-71: Escape in alertdialog acts like «Остаться»
  it('Escape in alertdialog navigates away and leaves the link unused', async () => {
    getSession.mockResolvedValueOnce({ data: { session: { user: { email: 'owner@example.com' } } } });
    renderPage(['/reset-password?token_hash=abc&type=invite']);
    await screen.findByTestId('invite-switch-account');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    expect(verifyOtpForRecovery).not.toHaveBeenCalled();
  });

  // N-71: Tab focus trap in alertdialog cycles between the two buttons
  it('Tab focus trap in alertdialog cycles between «Остаться» and «Продолжить»', async () => {
    getSession.mockResolvedValueOnce({ data: { session: { user: { email: 'owner@example.com' } } } });
    renderPage(['/reset-password?token_hash=abc&type=invite']);
    const stayBtn = await screen.findByText('Остаться');
    const continueBtn = await screen.findByText('Продолжить');

    // Focus starts on stayBtn
    stayBtn.focus();
    expect(document.activeElement).toBe(stayBtn);

    // Shift+Tab from Stay loops to Continue
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(continueBtn);

    // Tab from Continue loops to Stay
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: false });
    expect(document.activeElement).toBe(stayBtn);
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
    fireEvent.change(screen.getByLabelText('Повтори пароль'), { target: { value: 'bbbbbbbbbb' } });
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
    fireEvent.change(screen.getByLabelText('Повтори пароль'), { target: { value: 'new-secret-9' } });
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

describe('invite link opened a second time (prod 2026-10-05)', () => {
  it('a new tab of the same browser keeps the invitee signed in: no question, no sign-out, no second exchange', async () => {
    const url = ['/reset-password?token_hash=tok-twice&type=invite'];
    // Вкладка 1: входа не было, ссылка обменена.
    getSession.mockResolvedValue({ data: { session: null } });
    verifyOtpForRecovery.mockResolvedValueOnce('invitee@example.com');
    const first = renderPage(url);
    await waitFor(() => expect(verifyOtpForRecovery).toHaveBeenCalledWith('tok-twice', 'invite'));
    expect(await screen.findByText('Добро пожаловать в justwriting')).toBeTruthy();
    first.unmount();

    // Вкладка 2: письмо открыто ещё раз — sessionStorage новой вкладки пуст,
    // вход приглашённого жив.
    sessionStorage.clear();
    verifyOtpForRecovery.mockClear();
    getSession.mockResolvedValue({ data: { session: { user: { email: 'invitee@example.com' } } } });
    renderPage(url);
    expect(await screen.findByText('Добро пожаловать в justwriting')).toBeTruthy();
    expect(screen.queryByTestId('invite-switch-account')).toBeNull();
    expect(signOutUser).not.toHaveBeenCalled();
    expect(verifyOtpForRecovery).not.toHaveBeenCalled();
    getSession.mockResolvedValue({ data: { session: null } });
  });

  it('another account signed in after the exchange is still asked before anything happens', async () => {
    const url = ['/reset-password?token_hash=tok-other&type=invite'];
    getSession.mockResolvedValue({ data: { session: null } });
    verifyOtpForRecovery.mockResolvedValueOnce('invitee@example.com');
    const first = renderPage(url);
    await waitFor(() => expect(verifyOtpForRecovery).toHaveBeenCalled());
    first.unmount();

    sessionStorage.clear();
    verifyOtpForRecovery.mockClear();
    getSession.mockResolvedValue({ data: { session: { user: { email: 'owner@example.com' } } } });
    renderPage(url);
    expect(await screen.findByTestId('invite-switch-account')).toBeTruthy();
    expect(signOutUser).not.toHaveBeenCalled();
    getSession.mockResolvedValue({ data: { session: null } });
  });

  it('a used invitation with no sign-in says so in plain words and points to sign-in', async () => {
    verifyOtpForRecovery.mockRejectedValueOnce(new Error('Email link is invalid or has expired'));
    renderPage(['/reset-password?token_hash=used-invite&type=invite']);
    expect(await screen.findByText(/Эта ссылка-приглашение уже использована/)).toBeTruthy();
    expect(screen.queryByText('Запросить новую ссылку')).toBeNull();
  });
});

// V-1.2/V-1.3: что видит человек, который открыл обмененную ссылку не там, где
// начал настройку, и чем форма сброса отвечает на потерянный вход.
describe('used invitation: where to finish, and how errors are named', () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: null } });
    updateUserPassword.mockResolvedValue(undefined);
  });

  it('the used-invite message says to go back to the browser where the setup started', async () => {
    verifyOtpForRecovery.mockRejectedValueOnce(new Error('Invitation has already been used'));
    renderPage(['/reset-password?token_hash=used-2&type=invite']);
    expect(await screen.findByText(/Эта ссылка-приглашение уже использована/)).toBeTruthy();
    expect(screen.getByText(/Если настройка началась в другом браузере/)).toBeTruthy();
    expect(screen.getByText(/вернись туда/)).toBeTruthy();
  });

  it('an expired recovery link does not get the invitation-only advice', async () => {
    verifyOtpForRecovery.mockRejectedValueOnce(new Error('Email link is invalid or has expired'));
    renderPage(['/reset-password?token_hash=used-3&type=recovery']);
    expect(await screen.findByText(/Ссылка уже использована или устарела/)).toBeTruthy();
    expect(screen.queryByText(/настройка началась в другом браузере/)).toBeNull();
  });

  it('a lost link session is named as such, not as a failed password change', async () => {
    renderPage();
    act(() => { onPasswordRecoveryCb.fire(); });
    updateUserPassword.mockRejectedValueOnce(new Error('No signed-in user to set a password for'));
    fireEvent.change(screen.getByLabelText('Новый пароль'), { target: { value: 'new-secret-9' } });
    fireEvent.change(screen.getByLabelText('Повтори пароль'), { target: { value: 'new-secret-9' } });
    fireEvent.click(screen.getByText('Сменить пароль'));
    expect(await screen.findByText(/Вход по ссылке потерялся/)).toBeTruthy();
    expect(screen.queryByText(/Не удалось изменить пароль/)).toBeNull();
  });

  it('a request that never left the browser is still a network failure', async () => {
    renderPage();
    act(() => { onPasswordRecoveryCb.fire(); });
    updateUserPassword.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fireEvent.change(screen.getByLabelText('Новый пароль'), { target: { value: 'new-secret-9' } });
    fireEvent.change(screen.getByLabelText('Повтори пароль'), { target: { value: 'new-secret-9' } });
    fireEvent.click(screen.getByText('Сменить пароль'));
    expect(await screen.findByText(/Нет соединения с сетью/)).toBeTruthy();
  });

  // V-1.1 сквозь страницу: мастер должен получать хэш токена из адреса, иначе
  // после перезагрузки ему не по чему найти сохранённый шаг.
  it('a reload in the middle of the wizard resumes on the same step', async () => {
    const url = ['/reset-password?token_hash=tok-page-reload&type=invite'];
    verifyOtpForRecovery.mockResolvedValueOnce('invitee@example.com');
    const first = renderPage(url);
    await waitFor(() => expect(verifyOtpForRecovery).toHaveBeenCalledWith('tok-page-reload', 'invite'));
    await screen.findByText('Добро пожаловать в justwriting');
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    await screen.findByText('Придумай пароль');
    first.unmount();

    getSession.mockResolvedValue({ data: { session: { user: { email: 'invitee@example.com' } } } });
    renderPage(url);
    await screen.findByText('Придумай пароль');
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getAllByRole('checkbox')[0]).toBeChecked();
    getSession.mockResolvedValue({ data: { session: null } });
  });
});
