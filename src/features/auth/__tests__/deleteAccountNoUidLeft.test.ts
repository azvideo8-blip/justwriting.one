import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';

const USER = 'u_no_uid_left_after_delete';

const mockGetCurrentUser = vi.fn();
const mockReauthenticate = vi.fn();
const mockCallAi = vi.fn();

// In supabaseAuthProvider.ts:161, signOutUser sets jw_voluntary_signout_at_<uid>
const mockSignOutUser = vi.fn(async () => {
  localStorage.setItem(STORAGE_KEYS.VOLUNTARY_SIGNOUT_AT(USER), String(Date.now()));
});

vi.mock('../../../core/auth', () => ({
  getCurrentUser: () => mockGetCurrentUser(),
  getCurrentUserId: () => mockGetCurrentUser()?.uid ?? null,
  reauthenticate: (...args: unknown[]) => mockReauthenticate(...args),
  signOutUser: () => mockSignOutUser(),
}));

vi.mock('../../../core/ai/callAi', () => ({
  callAi: (...args: unknown[]) => mockCallAi(...args),
}));

describe('S-17: UID in localStorage key after deletion and wipe-sign-out', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetCurrentUser.mockReturnValue({ uid: USER, email: 'user@example.com' });
    mockReauthenticate.mockResolvedValue(undefined);
    mockCallAi.mockResolvedValue({ success: true });
  });

  it('no localStorage key contains uid after deleteAccount', async () => {
    // Seed some user data in localStorage
    localStorage.setItem(`enc_enabled_${USER}`, '1');
    localStorage.setItem(`draft-${USER}`, 'secret text');

    const { AuthService } = await import('../services/AuthService');
    await AuthService.deleteAccount('secretPassword');

    const remainingUserKeys = Object.keys(localStorage).filter(k => k.includes(USER));
    expect(remainingUserKeys).toEqual([]);
  });

  it('no localStorage key contains uid after signOut with clearLocalData', async () => {
    localStorage.setItem(`enc_enabled_${USER}`, '1');

    const { AuthService } = await import('../services/AuthService');
    await AuthService.signOut({ clearLocalData: true });

    const remainingUserKeys = Object.keys(localStorage).filter(k => k.includes(USER));
    expect(remainingUserKeys).toEqual([]);
  });
});
