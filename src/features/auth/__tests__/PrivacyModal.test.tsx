import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PrivacyModal } from '../components/PrivacyModal';
import { DataProvider } from '../../../core/data';
import { getCurrentUser } from '../../../core/auth';
import { PRIVACY_VERSION } from '../../../core/constants/privacyVersion';
import { LanguageProvider } from '../../../shared/i18n';

vi.mock('../../../core/auth', () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock('../../../core/data', () => ({
  DataProvider: {
    updateProfile: vi.fn(),
  },
}));

vi.mock('../../../shared/errors/reportError', () => ({
  reportError: vi.fn(),
}));

describe('PrivacyModal (AG-ONBOARD-3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(getCurrentUser).mockReturnValue({ uid: 'user_123' } as any);
    vi.mocked(DataProvider.updateProfile).mockResolvedValue(undefined);
  });

  it('renders semantic headings and intro sentence', () => {
    render(<LanguageProvider><PrivacyModal onAccepted={vi.fn()} /></LanguageProvider>);

    expect(screen.getByText(/justwriting — приватный редактор для свободного письма/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Политика конфиденциальности' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Как хранятся данные' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Что уходит третьим лицам' })).toBeInTheDocument();
  });

  it('renders distinct required terms checkbox and optional AI consent checkbox', () => {
    render(<LanguageProvider><PrivacyModal onAccepted={vi.fn()} /></LanguageProvider>);

    expect(screen.getByText(/Обязательно:/i)).toBeInTheDocument();
    expect(screen.getByText(/Необязательно, для функций ИИ:/i)).toBeInTheDocument();

    const submitBtn = screen.getByRole('button', { name: 'Продолжить' });
    expect(submitBtn).toBeDisabled();
  });

  it('submits required consent when only required checkbox is checked', async () => {
    const onAccepted = vi.fn();
    render(<LanguageProvider><PrivacyModal onAccepted={onAccepted} /></LanguageProvider>);

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);

    // Click required checkbox
    fireEvent.click(checkboxes[0]!);

    const submitBtn = screen.getByRole('button', { name: 'Продолжить' });
    expect(submitBtn).toBeEnabled();

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(DataProvider.updateProfile).toHaveBeenCalledWith('user_123', expect.objectContaining({
        privacyVersion: PRIVACY_VERSION,
        aiConsentAt: null,
        aiConsentVersion: null,
      }));
    });

    expect(localStorage.getItem('privacy_accepted_user_123')).toBe(String(PRIVACY_VERSION));
    expect(onAccepted).toHaveBeenCalledTimes(1);
  });

  it('submits both consents when AI consent is also checked', async () => {
    const onAccepted = vi.fn();
    render(<LanguageProvider><PrivacyModal onAccepted={onAccepted} /></LanguageProvider>);

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);

    const submitBtn = screen.getByRole('button', { name: 'Продолжить' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(DataProvider.updateProfile).toHaveBeenCalledWith('user_123', expect.objectContaining({
        privacyVersion: PRIVACY_VERSION,
        aiConsentVersion: PRIVACY_VERSION,
      }));
    });

    expect(localStorage.getItem('privacy_accepted_user_123')).toBe(String(PRIVACY_VERSION));
    expect(onAccepted).toHaveBeenCalledTimes(1);
  });
});
