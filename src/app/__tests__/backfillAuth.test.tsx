/**
 * Regression: backfillDocumentUuids ran with guestId for authenticated users
 * because getAuth().currentUser was null on mount (Firebase restores session
 * async).  The fix uses useAuthStatus() so the effect re-fires when auth
 * resolves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';

vi.mock('@/features/auth/hooks/useAuthStatus', () => ({
  useAuthStatus: vi.fn(),
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/auth/components/PrivacyModal', () => ({
  PrivacyModal: () => null,
  usePrivacyCheck: () => ({ showPrivacy: false, setShowPrivacy: vi.fn() }),
}));

vi.mock('@/features/ai/hooks/useEmbeddingIndexer', () => ({
  useEmbeddingIndexer: vi.fn(),
}));

vi.mock('@/core/services/LocalDocumentService', () => ({
  LocalDocumentService: {
    backfillDocumentUuids: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock('@/shared/errors/reportError', () => ({
  reportError: vi.fn(),
}));

import { useAuthStatus } from '@/features/auth/hooks/useAuthStatus';
import { LocalDocumentService } from '@/core/services/LocalDocumentService';
import { AppProviders } from '../AppProviders';

const mockUseAuthStatus = vi.mocked(useAuthStatus);
const mockBackfill = vi.mocked(LocalDocumentService.backfillDocumentUuids);

function baseAuth() {
  return {
    user: null,
    profile: null,
    authState: 'loading' as const,
    isAuthenticated: false,
    isGuest: true,
    loading: true,
    isConnected: false,
  };
}

describe('backfillDocumentUuids — auth user id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuthStatus.mockReturnValue(baseAuth());
  });

  it('runs backfill with uid once user authenticates, not guestId', async () => {
    render(<AppProviders><div /></AppProviders>);

    // On mount, user is null → backfill should not yet be called with a uid.
    await act(async () => {});
    expect(mockBackfill).not.toHaveBeenCalledWith(expect.stringMatching(/^u-/));

    // Auth resolves.
    mockUseAuthStatus.mockReturnValue({
      ...baseAuth(),
      user: { uid: 'auth-user-1' } as never,
      isAuthenticated: true,
      isGuest: false,
      loading: false,
      authState: 'authenticated',
    });

    render(<AppProviders><div /></AppProviders>);

    await waitFor(() => {
      expect(mockBackfill).toHaveBeenCalledWith('auth-user-1');
    });
  });
});
