import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { usePrivacyCheck } from '../components/PrivacyModal';

const mockGetDoc = vi.fn();
vi.mock('../../../core/firebase/firestoreClient', () => ({
  getClient: async () => ({
    db: {},
    mod: { doc: (_db: unknown, ...p: string[]) => ({ path: p.join('/') }), getDoc: mockGetDoc },
  }),
}));

let authStatus: { user: { uid: string } | null; authState: string } = { user: null, authState: 'loading' };
vi.mock('../../../app/useAuthStatus', () => ({
  useAuthStatus: () => authStatus,
}));

// Firebase restores the session asynchronously, so auth.currentUser is almost
// always null at mount. Reading it once returned on the first line and never ran
// again — nobody was ever asked for consent.
describe('usePrivacyCheck waits for the restored session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    authStatus = { user: null, authState: 'loading' };
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
  });

  it('asks a user who only appears after mount', async () => {
    const { result, rerender } = renderHook(() => usePrivacyCheck());
    expect(result.current.showPrivacy).toBe(false);

    authStatus = { user: { uid: 'u1' }, authState: 'authenticated' };
    rerender();

    await waitFor(() => expect(result.current.showPrivacy).toBe(true));
  });

  it('does not ask again when consent is already cached locally', async () => {
    localStorage.setItem('privacy_accepted_u1', 'true');
    authStatus = { user: { uid: 'u1' }, authState: 'authenticated' };

    const { result } = renderHook(() => usePrivacyCheck());

    await waitFor(() => expect(mockGetDoc).not.toHaveBeenCalled());
    expect(result.current.showPrivacy).toBe(false);
  });

  it('ignores a late answer about the account that just got switched away', async () => {
    let release: (v: unknown) => void = () => {};
    mockGetDoc.mockReturnValueOnce(new Promise(res => { release = res; }));
    authStatus = { user: { uid: 'u1' }, authState: 'authenticated' };

    const { result, rerender } = renderHook(() => usePrivacyCheck());

    // u1 signs out before the read comes back; the pending answer is about them.
    authStatus = { user: null, authState: 'guest' };
    rerender();

    // Let the late answer land before asserting — waiting for `false` alone
    // would pass simply by checking too early.
    await act(async () => {
      release({ exists: () => false, data: () => ({}) });
      await new Promise(r => setTimeout(r, 0));
    });

    expect(result.current.showPrivacy).toBe(false);
  });
});
