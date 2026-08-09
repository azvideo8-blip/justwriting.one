import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUserId } from '../useUserId';

describe('useUserId', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal('crypto', {
      randomUUID: () => 'abc123',
    });
  });

  it('returns user uid when user is provided', () => {
    const mockAppUser = { uid: 'user_123' } as { uid: string };
    const { result } = renderHook(() => useUserId(mockAppUser as unknown as { uid: string }));
    expect(result.current).toBe('user_123');
  });

  it('returns guestId when user is null', () => {
    const { result } = renderHook(() => useUserId(null));
    expect(result.current).toBe('guest_abc123');
  });

  it('returns guestId when user is undefined', () => {
    const { result } = renderHook(() => useUserId(undefined as unknown as { uid: string } | null));
    expect(result.current).toBe('guest_abc123');
  });
});
