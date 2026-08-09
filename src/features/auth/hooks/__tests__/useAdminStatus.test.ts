import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAdminStatus } from '../useAdminStatus';
import { useAuth } from '../../contexts/AuthContext';
import { useProfile } from '../../contexts/ProfileContext';

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../contexts/ProfileContext', () => ({
  useProfile: vi.fn(),
}));

describe('AG-ADMIN-claim — useAdminStatus Hook', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('Returns isAdmin=true when profile role is admin', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: { uid: 'user-123' }, loading: false } as any);
    vi.mocked(useProfile).mockReturnValue({ profile: { role: 'admin' } } as any);

    const { result } = renderHook(() => useAdminStatus());

    expect(result.current.loading).toBe(false);
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.isStaleToken).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('Returns isAdmin=false when profile role is user', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: { uid: 'user-123' }, loading: false } as any);
    vi.mocked(useProfile).mockReturnValue({ profile: { role: 'user' } } as any);

    const { result } = renderHook(() => useAdminStatus());

    expect(result.current.loading).toBe(false);
    expect(result.current.isAdmin).toBe(false);
  });

  it('Sets loading to true when auth is loading', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: true } as any);
    vi.mocked(useProfile).mockReturnValue({ profile: null } as any);

    const { result } = renderHook(() => useAdminStatus());

    expect(result.current.loading).toBe(true);
  });

  it('Sets loading to true when user is present but profile is not loaded', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: { uid: 'user-123' }, loading: false } as any);
    vi.mocked(useProfile).mockReturnValue({ profile: null } as any);

    const { result } = renderHook(() => useAdminStatus());

    expect(result.current.loading).toBe(true);
  });
});
