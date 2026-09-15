import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { renderWithProviders } from '../../../../test/utils/render';
import { AccountSecuritySection } from '../AccountSecuritySection';
import { AuthService } from '../../../auth/services/AuthService';

const { mockShowToast } = vi.hoisted(() => ({
  mockShowToast: vi.fn(),
}));

vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}));

vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({
    isAuthenticated: true,
  }),
}));

vi.mock('../../../auth/services/AuthService', () => ({
  AuthService: {
    getCurrentUser: vi.fn().mockReturnValue({ email: 'test@example.com', uid: 'user-1' }),
    signOutOthers: vi.fn(),
  },
}));

vi.mock('../AccountVaultSection', () => ({
  AccountVaultSection: () => <div data-testid="mock-vault-section" />,
}));

vi.mock('../AccountAISection', () => ({
  AccountAISection: () => <div data-testid="mock-ai-section" />,
}));

describe('AccountSecuritySection (UI-09)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders sessions section and calls signOutOthers on button click', async () => {
    vi.mocked(AuthService.signOutOthers).mockResolvedValue(undefined);

    renderWithProviders(<AccountSecuritySection userId="user-1" />);

    expect(screen.getByText('Сеансы на других устройствах')).toBeInTheDocument();
    const signOutBtn = screen.getByRole('button', { name: 'Выйти на остальных устройствах' });
    expect(signOutBtn).toBeInTheDocument();

    fireEvent.click(signOutBtn);

    await waitFor(() => {
      expect(AuthService.signOutOthers).toHaveBeenCalledTimes(1);
      expect(mockShowToast).toHaveBeenCalledWith('Сеансы на остальных устройствах завершены', 'success');
    });
  });

  it('shows error toast when signOutOthers fails', async () => {
    vi.mocked(AuthService.signOutOthers).mockRejectedValueOnce(new Error('Network error'));

    renderWithProviders(<AccountSecuritySection userId="user-1" />);

    const signOutBtn = screen.getByRole('button', { name: 'Выйти на остальных устройствах' });
    fireEvent.click(signOutBtn);

    await waitFor(() => {
      expect(AuthService.signOutOthers).toHaveBeenCalledTimes(1);
      expect(mockShowToast).toHaveBeenCalledWith('Не удалось завершить другие сеансы', 'error');
    });
  });
});
