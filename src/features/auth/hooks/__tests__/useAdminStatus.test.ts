import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAdminStatus } from '../useAdminStatus';
import { useAuth } from '../../contexts/AuthContext';
import { useProfile } from '../../contexts/ProfileContext';
import { getAuth, onIdTokenChanged, type User } from 'firebase/auth';

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../contexts/ProfileContext', () => ({
  useProfile: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({ currentUser: null })),
  onIdTokenChanged: vi.fn(() => () => {}),
}));

describe('AG-ADMIN-claim — useAdminStatus Hook', () => {
  const mockUser = {
    uid: 'user-123',
    getIdTokenResult: vi.fn(),
    getIdToken: vi.fn(),
  } as unknown as User;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAuth).mockReturnValue({ currentUser: mockUser } as unknown as ReturnType<typeof getAuth>);
    vi.mocked(onIdTokenChanged).mockImplementation((_auth, callback) => {
      // @ts-expect-error test mock callback
      callback(mockUser);
      return () => {};
    });
  });

  it('Requirement 1: Returns isAdmin=true when ID token has role === admin claim', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: mockUser, loading: false } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(useProfile).mockReturnValue({ profile: { role: 'admin' } } as unknown as ReturnType<typeof useProfile>);
    vi.mocked(mockUser.getIdTokenResult).mockResolvedValue({ claims: { role: 'admin' } } as unknown as Awaited<ReturnType<typeof mockUser.getIdTokenResult>>);

    const { result } = renderHook(() => useAdminStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAdmin).toBe(true);
    expect(result.current.isStaleToken).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('Requirement 2: Silent token refresh (getIdToken(true)) succeeds when token is stale', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: mockUser, loading: false } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(useProfile).mockReturnValue({ profile: { role: 'admin' } } as unknown as ReturnType<typeof useProfile>);

    let refreshed = false;
    vi.mocked(mockUser.getIdToken).mockImplementation(async (force) => {
      if (force) refreshed = true;
      return 'fresh-token';
    });
    vi.mocked(mockUser.getIdTokenResult).mockImplementation(async () => {
      return { claims: refreshed ? { role: 'admin' } : {} } as unknown as Awaited<ReturnType<typeof mockUser.getIdTokenResult>>;
    });

    const { result } = renderHook(() => useAdminStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockUser.getIdToken).toHaveBeenCalledWith(true);
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.isStaleToken).toBe(false);
  });

  it('Requirement 3: Sets isStaleToken=true and actionable error string when refreshed token claim is still missing', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: mockUser, loading: false } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(useProfile).mockReturnValue({ profile: { role: 'admin' } } as unknown as ReturnType<typeof useProfile>);

    // Both checks return missing claim
    vi.mocked(mockUser.getIdTokenResult).mockResolvedValue({ claims: {} } as unknown as Awaited<ReturnType<typeof mockUser.getIdTokenResult>>);
    vi.mocked(mockUser.getIdToken).mockResolvedValue('refreshed-but-still-user-token');

    const { result } = renderHook(() => useAdminStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isStaleToken).toBe(true);
    expect(result.current.error).toContain('токен сессии устарел');
  });

  it('Requirement 4: Returns isAdmin=false, isStaleToken=false when neither profile nor claim is admin', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: mockUser, loading: false } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(useProfile).mockReturnValue({ profile: { role: 'user' } } as unknown as ReturnType<typeof useProfile>);
    vi.mocked(mockUser.getIdTokenResult).mockResolvedValue({ claims: {} } as unknown as Awaited<ReturnType<typeof mockUser.getIdTokenResult>>);

    const { result } = renderHook(() => useAdminStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isStaleToken).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
