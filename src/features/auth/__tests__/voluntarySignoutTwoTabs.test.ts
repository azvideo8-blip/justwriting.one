import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { takeAccountChangeNotice } from '../../../core/auth/accountReload';

// S-33.4 (S-17 × S-28): вкладка 1 выходит со стиранием; вкладка 2 получает
// SIGNED_OUT через storage-событие и по отметке `jw_voluntary_signout_at_<uid>`
// отличает «вышел сам» от обрыва сессии. S-17 стирал отметку сразу после
// выхода — вкладка 2 проигрывала гонку, записывала обрыв и предлагала стереть
// гостевую базу, которую добровольный выход оставил.

const USER = 'u_two_tabs';

// Вкладка 1: AuthService поверх замоканного индекса core/auth; signOutUser
// ставит отметку так же, как настоящий (supabaseAuthProvider.signOutUser).
vi.mock('../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: USER, email: 't@example.com' }),
  getCurrentUserId: () => USER,
  signOutUser: vi.fn(async () => {
    localStorage.setItem(STORAGE_KEYS.VOLUNTARY_SIGNOUT_AT(USER), String(Date.now()));
  }),
}));

// Вкладка 2: настоящий провайдер с замоканным клиентом Supabase.
let fireTab2: ((event: string, session: unknown) => void) | undefined;
vi.mock('../../../core/supabase/client', () => ({
  getSupabase: () => ({
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        fireTab2 = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  }),
}));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('S-33.4: a voluntary sign-out with wipe in tab 1 is not a lost session in tab 2', () => {
  it('tab 2 sees the mark after tab 1 finished signing out', async () => {
    const provider = await import('../../../core/auth/supabaseAuthProvider');
    provider._resetAuthStateForTesting();
    provider.getCurrentUser();
    fireTab2!('SIGNED_IN', { user: { id: USER, email: 't@example.com' } });

    const { AuthService } = await import('../services/AuthService');
    await AuthService.signOut({ clearLocalData: true, force: true });
    takeAccountChangeNotice(); // уведомление вкладки 1 («вы вышли»)

    // storage-событие доходит до вкладки 2 уже после того, как вкладка 1 закончила выход
    fireTab2!('SIGNED_OUT', null);

    expect(takeAccountChangeNotice(), 'вкладка 2 приняла добровольный выход за обрыв сессии').not.toBe('lost_session');
    expect(localStorage.getItem(STORAGE_KEYS.LOST_SESSION_UID)).toBeNull();
  });
});
