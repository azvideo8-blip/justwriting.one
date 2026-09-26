import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as reportErrorModule from '../../../shared/errors/reportError';

const mockRefreshSession = vi.fn();
const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();
const mockSignOut = vi.fn();

vi.mock('../../supabase/client', () => ({
  getSupabase: vi.fn(() => ({
    auth: {
      refreshSession: (...args: unknown[]) => mockRefreshSession(...args),
      getSession: (...args: unknown[]) => mockGetSession(...args),
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
    },
  })),
}));

vi.mock('../../../shared/errors/reportError', () => ({
  reportError: vi.fn(),
}));

import { getIdToken, signOutUser, getCurrentUser, _resetAuthStateForTesting } from '../supabaseAuthProvider';
import { mapAIError } from '../../../features/ai/services/AIService';

describe('ERR-3: auth session error visibility and token refresh failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem('jw_voluntary_signout_at');
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

  it('does NOT report error when SIGNED_OUT is triggered voluntarily via signOutUser()', async () => {
    _resetAuthStateForTesting();
    let authStateCallback: ((event: string, session: unknown) => void) | undefined;
    mockOnAuthStateChange.mockImplementation((cb: (event: string, session: unknown) => void) => {
      authStateCallback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    mockSignOut.mockImplementation(async () => {
      // Supabase client fires onAuthStateChange during signOut
      authStateCallback?.('SIGNED_OUT', null);
      return { error: null };
    });

    // Initialize subscriber and set current user
    getCurrentUser();
    authStateCallback?.('SIGNED_IN', { user: { id: 'u_test_1', email: 'test@example.com' } });
    expect(getCurrentUser()?.uid).toBe('u_test_1');

    // Voluntary sign out
    await signOutUser();

    expect(getCurrentUser()).toBeNull();
    expect(reportErrorModule.reportError).not.toHaveBeenCalled();
  });

  it('reports error when SIGNED_OUT is triggered unexpectedly (without signOutUser)', async () => {
    _resetAuthStateForTesting();
    let authStateCallback: ((event: string, session: unknown) => void) | undefined;
    mockOnAuthStateChange.mockImplementation((cb: (event: string, session: unknown) => void) => {
      authStateCallback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    // Initialize subscriber and set current user
    getCurrentUser();
    authStateCallback?.('SIGNED_IN', { user: { id: 'u_test_2', email: 'test@example.com' } });
    expect(getCurrentUser()?.uid).toBe('u_test_2');

    // Unexpected sign out (e.g. server token revocation / expired refresh token)
    authStateCallback?.('SIGNED_OUT', null);

    expect(getCurrentUser()).toBeNull();
    expect(reportErrorModule.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('SESSION_TERMINATED') }),
      expect.objectContaining({ action: 'auth_session_signed_out', previousUid: 'u_test_2' }),
      'warning',
    );
  });

  it('a hidden tab reloads when another tab switches the account, instead of carrying on as the old user', () => {
    _resetAuthStateForTesting();
    let authStateCallback: ((event: string, session: unknown) => void) | undefined;
    mockOnAuthStateChange.mockImplementation((cb: (event: string, session: unknown) => void) => {
      authStateCallback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    const reload = vi.fn();
    const origLocation = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...origLocation, reload } });
    const vis = vi.spyOn(document, 'visibilityState', 'get');
    try {
      getCurrentUser();
      authStateCallback?.('SIGNED_IN', { user: { id: 'owner', email: 'a@example.com' } });

      vis.mockReturnValue('visible');
      authStateCallback?.('TOKEN_REFRESHED', { user: { id: 'owner', email: 'a@example.com' } });
      expect(reload).not.toHaveBeenCalled();

      vis.mockReturnValue('hidden');
      authStateCallback?.('SIGNED_IN', { user: { id: 'invitee', email: 'b@example.com' } });
      expect(reload).toHaveBeenCalledTimes(1);
      expect(reportErrorModule.reportError).not.toHaveBeenCalled();
    } finally {
      vis.mockRestore();
      Object.defineProperty(window, 'location', { configurable: true, value: origLocation });
    }
  });

  it('the visible tab switching accounts itself does not reload', () => {
    _resetAuthStateForTesting();
    let authStateCallback: ((event: string, session: unknown) => void) | undefined;
    mockOnAuthStateChange.mockImplementation((cb: (event: string, session: unknown) => void) => {
      authStateCallback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    const reload = vi.fn();
    const origLocation = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...origLocation, reload } });
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    try {
      getCurrentUser();
      authStateCallback?.('SIGNED_IN', { user: { id: 'owner', email: 'a@example.com' } });
      authStateCallback?.('SIGNED_IN', { user: { id: 'invitee', email: 'b@example.com' } });
      expect(reload).not.toHaveBeenCalled();
      expect(getCurrentUser()?.uid).toBe('invitee');
    } finally {
      vis.mockRestore();
      Object.defineProperty(window, 'location', { configurable: true, value: origLocation });
    }
  });

  it('a sign-out made in another tab a moment ago is not reported as unexpected', () => {
    _resetAuthStateForTesting();
    let authStateCallback: ((event: string, session: unknown) => void) | undefined;
    mockOnAuthStateChange.mockImplementation((cb: (event: string, session: unknown) => void) => {
      authStateCallback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    getCurrentUser();
    authStateCallback?.('SIGNED_IN', { user: { id: 'u_tab', email: 'a@example.com' } });
    localStorage.setItem('jw_voluntary_signout_at', String(Date.now())); // соседняя вкладка нажала «Выйти»
    authStateCallback?.('SIGNED_OUT', null);
    expect(reportErrorModule.reportError).not.toHaveBeenCalled();
    localStorage.removeItem('jw_voluntary_signout_at');
  });
});
