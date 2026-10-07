import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { LoginPage } from '../pages/LoginPage';
import { AuthService } from '../services/AuthService';
import { reportError } from '../../../shared/errors/reportError';

vi.mock('../services/AuthService', () => ({
  AuthService: {
    sendPasswordReset: vi.fn(),
    loginWithEmail: vi.fn(),
    loginWithGoogle: vi.fn(),
    loginWithYandex: vi.fn(),
    registerWithEmail: vi.fn(),
  },
}));

vi.mock('../../../shared/errors/reportError', () => ({
  reportError: vi.fn(),
}));

vi.mock('../../../shared/i18n', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    language: 'ru',
    setLanguage: vi.fn(),
  }),
}));

vi.mock('../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('../../../core/auth', () => ({
  onAuthStateChange: () => () => {},
  getCurrentUser: () => null,
}));

vi.mock('../../../core/data', () => ({
  DataProvider: {
    getProfile: vi.fn().mockResolvedValue(null),
    updateProfile: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: null, authState: 'unauthenticated' }),
}));

const { mockLocation } = vi.hoisted(() => ({
  mockLocation: vi.fn().mockReturnValue({ search: '', state: null }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => mockLocation(),
}));

describe('LoginPage (JW-SEC-08: prevent user enumeration on forgot password)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocation.mockReturnValue({ search: '', state: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function openForgotPasswordModal() {
    render(<LoginPage isModal={true} onClose={vi.fn()} />);
    const forgotBtn = screen.getByText('auth_forgot_password');
    fireEvent.click(forgotBtn);
    await waitFor(() => {
      expect(screen.getByText('auth_forgot_title')).toBeInTheDocument();
    });
  }

  it('renders confirmation and hides error when auth/user-not-found is returned', async () => {
    const error = { code: 'auth/user-not-found', message: 'User not found' };
    vi.mocked(AuthService.sendPasswordReset).mockRejectedValueOnce(error);

    await openForgotPasswordModal();

    const emailInputs = screen.getAllByPlaceholderText('auth_email_placeholder');
    const modalEmailInput = emailInputs[emailInputs.length - 1]!;
    fireEvent.change(modalEmailInput, { target: { value: 'nonexistent@example.com' } });

    const submitBtn = screen.getByText('auth_forgot_confirm_anyway');
    fireEvent.click(submitBtn);

    // Should display success message (auth_forgot_sent_to)
    await waitFor(() => {
      expect(screen.getByText('auth_forgot_sent_to')).toBeInTheDocument();
    });

    // Should NOT show user not found error (auth_error_user_not_found)
    expect(screen.queryByText('auth_error_user_not_found')).not.toBeInTheDocument();

    // Should report error to internal diagnostics
    expect(reportError).toHaveBeenCalledWith(error, { action: 'sendPasswordReset' });
  });

  it('resend button disabled with countdown and enables after 60s (UI-08)', async () => {
    vi.mocked(AuthService.sendPasswordReset).mockResolvedValue(undefined);

    await openForgotPasswordModal();

    const emailInputs = screen.getAllByPlaceholderText('auth_email_placeholder');
    const modalEmailInput = emailInputs[emailInputs.length - 1]!;
    fireEvent.change(modalEmailInput, { target: { value: 'test@example.com' } });

    vi.useFakeTimers();

    const submitBtn = screen.getByText('auth_forgot_confirm_anyway');
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(screen.getByText('auth_forgot_sent_to')).toBeInTheDocument();
    expect(AuthService.sendPasswordReset).toHaveBeenCalledTimes(1);

    // Resend button should be disabled during countdown
    const resendBtn = screen.getByRole('button', { name: /auth_forgot_resend/i });
    expect(resendBtn).toBeDisabled();

    // Fast-forward 61 seconds with fake timers to complete cooldown
    act(() => {
      vi.advanceTimersByTime(61_000);
    });

    // Resend button should now be enabled
    expect(resendBtn).toBeEnabled();

    // Clicking resend calls sendPasswordReset a second time
    await act(async () => {
      fireEvent.click(resendBtn);
    });
    expect(AuthService.sendPasswordReset).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('displays generic error on network or rate limit failure', async () => {
    const error = { code: 'auth/network-request-failed', message: 'Network failed' };
    vi.mocked(AuthService.sendPasswordReset).mockRejectedValueOnce(error);

    await openForgotPasswordModal();

    const emailInputs = screen.getAllByPlaceholderText('auth_email_placeholder');
    const modalEmailInput = emailInputs[emailInputs.length - 1]!;
    fireEvent.change(modalEmailInput, { target: { value: 'user@example.com' } });

    const submitBtn = screen.getByText('auth_forgot_confirm_anyway');
    fireEvent.click(submitBtn);

    // Should display generic error message
    await waitFor(() => {
      expect(screen.getByText('auth_error_generic')).toBeInTheDocument();
    });

    expect(reportError).toHaveBeenCalledWith(error, { action: 'sendPasswordReset' });
  });

  it('displays auth_error_invalid_email on validation_failed / 400 error (F-4)', async () => {
    const error = { code: 'validation_failed', status: 400, message: 'Unable to validate email address: invalid format' };
    vi.mocked(AuthService.sendPasswordReset).mockRejectedValueOnce(error);

    await openForgotPasswordModal();

    const emailInputs = screen.getAllByPlaceholderText('auth_email_placeholder');
    const modalEmailInput = emailInputs[emailInputs.length - 1]!;
    fireEvent.change(modalEmailInput, { target: { value: 'bad@domain' } });

    const form = modalEmailInput.closest('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText('auth_error_invalid_email')).toBeInTheDocument();
    });
  });

  it('does not use w-screen and stays within 390px mobile viewport bounds (S-14)', () => {
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;
    try {
      window.innerWidth = 390;
      window.innerHeight = 844;
      const { container } = render(<LoginPage />);
      const rootDiv = container.firstElementChild as HTMLElement;
      expect(rootDiv).not.toBeNull();
      // Ensure w-screen is not used (causes horizontal overflow with scrollbars on mobile)
      expect(rootDiv.className).not.toContain('w-screen');
      expect(rootDiv.className).toContain('w-full');
      expect(rootDiv.className).toContain('min-h-screen');
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    } finally {
      window.innerWidth = originalInnerWidth;
      window.innerHeight = originalInnerHeight;
    }
  });

  it('prefills email from location.state and focuses password input (AG-ONBOARD-2)', () => {
    mockLocation.mockReturnValue({ search: '', state: { email: 'prefilled@example.com' } });
    render(<LoginPage />);

    const emailInput = screen.getByPlaceholderText('auth_email_placeholder');
    expect(emailInput).toHaveValue('prefilled@example.com');

    const passwordInput = screen.getByPlaceholderText('••••••••');
    expect(passwordInput).toHaveFocus();
  });

  it('prefills email from search query param and focuses password input', () => {
    mockLocation.mockReturnValue({ search: '?email=query@example.com', state: null });
    render(<LoginPage />);

    const emailInput = screen.getByPlaceholderText('auth_email_placeholder');
    expect(emailInput).toHaveValue('query@example.com');

    const passwordInput = screen.getByPlaceholderText('••••••••');
    expect(passwordInput).toHaveFocus();
  });

  it('регистрация закрыта: кнопка «Регистрация» открывает окно со ссылкой на чат в Telegram', () => {
    render(<LoginPage isModal={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'auth_signup_closed_btn' }));
    const dialog = screen.getByRole('dialog', { name: 'auth_signup_closed_title' });
    const link = dialog.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://t.me/andreyzubkov');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toContain('noopener');
    fireEvent.click(screen.getByRole('button', { name: 'auth_signup_closed_close' }));
    expect(screen.queryByRole('dialog', { name: 'auth_signup_closed_title' })).toBeNull();
  });
});
