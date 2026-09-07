import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from '../ProtectedRoute';

const mockUseAuthStatus = vi.fn();
const mockUseAdminStatus = vi.fn();
const mockOpenLoginModal = vi.fn();

vi.mock('../../features/auth/hooks/useAuthStatus', () => ({
  useAuthStatus: () => mockUseAuthStatus(),
}));

vi.mock('../../features/auth/hooks/useAdminStatus', () => ({
  useAdminStatus: () => mockUseAdminStatus(),
}));

vi.mock('../../features/auth/contexts/LoginModalContext', () => ({
  useLoginModal: () => ({ openLoginModal: mockOpenLoginModal }),
}));

vi.mock('../../shared/i18n', () => ({
  useLanguage: () => ({
    t: (k: string) => k,
    tp: (k: string) => k,
  }),
}));

describe('ProtectedRoute (L-13)', () => {
  it('redirects unauthenticated guest to / when requireAdmin is true', () => {
    mockUseAuthStatus.mockReturnValue({ isAuthenticated: false, loading: false });
    mockUseAdminStatus.mockReturnValue({ isAdmin: false, loading: false });

    render(
      <MemoryRouter initialEntries={['/diagnostics']}>
        <Routes>
          <Route path="/" element={<div>Home Page</div>} />
          <Route
            path="/diagnostics"
            element={
              <ProtectedRoute requireAdmin>
                <div>Admin Content</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Home Page')).toBeInTheDocument();
    expect(screen.queryByText('auth_required_title')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin Content')).not.toBeInTheDocument();
  });

  it('redirects authenticated non-admin user to / when requireAdmin is true', () => {
    mockUseAuthStatus.mockReturnValue({ isAuthenticated: true, loading: false });
    mockUseAdminStatus.mockReturnValue({ isAdmin: false, loading: false });

    render(
      <MemoryRouter initialEntries={['/diagnostics']}>
        <Routes>
          <Route path="/" element={<div>Home Page</div>} />
          <Route
            path="/diagnostics"
            element={
              <ProtectedRoute requireAdmin>
                <div>Admin Content</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Home Page')).toBeInTheDocument();
    expect(screen.queryByText('Admin Content')).not.toBeInTheDocument();
  });

  it('renders children for admin user when requireAdmin is true', () => {
    mockUseAuthStatus.mockReturnValue({ isAuthenticated: true, loading: false });
    mockUseAdminStatus.mockReturnValue({ isAdmin: true, loading: false });

    render(
      <MemoryRouter initialEntries={['/diagnostics']}>
        <Routes>
          <Route path="/" element={<div>Home Page</div>} />
          <Route
            path="/diagnostics"
            element={
              <ProtectedRoute requireAdmin>
                <div>Admin Content</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Admin Content')).toBeInTheDocument();
  });

  it('renders auth required barrier for guest when requireAdmin is false', () => {
    mockUseAuthStatus.mockReturnValue({ isAuthenticated: false, loading: false });
    mockUseAdminStatus.mockReturnValue({ isAdmin: false, loading: false });

    render(
      <MemoryRouter initialEntries={['/private']}>
        <Routes>
          <Route
            path="/private"
            element={
              <ProtectedRoute>
                <div>Private Content</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('auth_required_title')).toBeInTheDocument();
    expect(screen.queryByText('Private Content')).not.toBeInTheDocument();
  });
});
