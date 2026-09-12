import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ search: '' }),
}));

describe('LoginPage (JW-SEC-08: prevent user enumeration on forgot password)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    // Should display success message (auth_forgot_sent)
    await waitFor(() => {
      expect(screen.getByText('auth_forgot_sent')).toBeInTheDocument();
    });

    // Should NOT show user not found error (auth_error_user_not_found)
    expect(screen.queryByText('auth_error_user_not_found')).not.toBeInTheDocument();

    // Should report error to internal diagnostics
    expect(reportError).toHaveBeenCalledWith(error, { action: 'sendPasswordReset' });
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
});
