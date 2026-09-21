import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as reportErrorModule from '../../../shared/errors/reportError';

const mockRefreshSession = vi.fn();
const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();

vi.mock('../../supabase/client', () => ({
  getSupabase: vi.fn(() => ({
    auth: {
      refreshSession: (...args: unknown[]) => mockRefreshSession(...args),
      getSession: (...args: unknown[]) => mockGetSession(...args),
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
    },
  })),
}));

vi.mock('../../../shared/errors/reportError', () => ({
  reportError: vi.fn(),
}));

import { getIdToken } from '../supabaseAuthProvider';
import { mapAIError } from '../../../features/ai/services/AIService';

describe('ERR-3: auth session error visibility and token refresh failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
  });

  it('getIdToken(true) returns null and calls reportError when refreshSession fails', async () => {
    const refreshError = new Error('Invalid Refresh Token');
    mockRefreshSession.mockResolvedValue({ data: { session: null }, error: refreshError });
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'stale-token' } } });

    const token = await getIdToken(true);

    expect(token).toBeNull();
    expect(reportErrorModule.reportError).toHaveBeenCalledWith(
      refreshError,
      expect.objectContaining({ action: 'getIdToken_refreshSession' }),
      'warning',
    );
  });

  it('getIdToken(true) returns new token when refreshSession succeeds', async () => {
    mockRefreshSession.mockResolvedValue({ data: { session: { access_token: 'fresh-token' } }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'fresh-token' } } });

    const token = await getIdToken(true);

    expect(token).toBe('fresh-token');
    expect(reportErrorModule.reportError).not.toHaveBeenCalled();
  });

  it('mapAIError correctly maps uppercase UNAUTHENTICATED and status 401 to AUTH_REQUIRED', () => {
    expect(mapAIError({ code: 'UNAUTHENTICATED' })).toBe('AUTH_REQUIRED');
    expect(mapAIError({ code: 'unauthenticated' })).toBe('AUTH_REQUIRED');
    expect(mapAIError({ status: 401 })).toBe('AUTH_REQUIRED');
    expect(mapAIError({ message: 'AUTH_REQUIRED' })).toBe('AUTH_REQUIRED');
    expect(mapAIError({ message: 'unauthenticated' })).toBe('AUTH_REQUIRED');
  });
});
