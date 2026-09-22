import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AppRoutes } from '../AppRoutes';

vi.mock('../../features/auth/hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: null, profile: null, isGuest: true }),
}));

vi.mock('../pages/WritingPage', () => ({
  WritingPage: () => <div data-testid="writing-page">Writing Page</div>,
}));

vi.mock('../../features/auth/pages/ResetPasswordPage', () => ({
  ResetPasswordPage: () => {
    const location = useLocation();
    return <div data-testid="reset-password-page">Reset Password Page Hash: {location.hash}</div>;
  },
}));

describe('AppRoutes Legacy Hash Redirect (N-3 / F-05)', () => {
  it('redirects root / with legacy invite hash to /reset-password preserving hash', async () => {
    const hash = '#access_token=sample_token&type=invite';
    render(
      <MemoryRouter initialEntries={[`/${hash}`]}>
        <AppRoutes />
      </MemoryRouter>
    );

    expect(await screen.findByTestId('reset-password-page')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(hash))).toBeInTheDocument();
    expect(screen.queryByTestId('writing-page')).not.toBeInTheDocument();
  });

  it('redirects root / with legacy recovery hash to /reset-password preserving hash', async () => {
    const hash = '#access_token=sample_token&type=recovery';
    render(
      <MemoryRouter initialEntries={[`/${hash}`]}>
        <AppRoutes />
      </MemoryRouter>
    );

    expect(await screen.findByTestId('reset-password-page')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(hash))).toBeInTheDocument();
    expect(screen.queryByTestId('writing-page')).not.toBeInTheDocument();
  });

  it('renders WritingPage normally when root / has no auth hash', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>
    );

    expect(await screen.findByTestId('writing-page')).toBeInTheDocument();
  });
});
