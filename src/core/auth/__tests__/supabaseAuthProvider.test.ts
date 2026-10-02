import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as reportErrorModule from '../../../shared/errors/reportError';

const mockRefreshSession = vi.fn();
const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();
const mockSignOut = vi.fn();
const mockVerifyOtp = vi.fn();

vi.mock('../../supabase/client', () => ({
  getSupabase: vi.fn(() => ({
    auth: {
      refreshSession: (...args: unknown[]) => mockRefreshSession(...args),
      getSession: (...args: unknown[]) => mockGetSession(...args),
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
      verifyOtp: (...args: unknown[]) => mockVerifyOtp(...args),
    },
  })),
}));

vi.mock('../../../shared/errors/reportError', () => ({
  reportError: vi.fn(),
}));

import { getIdToken, signOutUser, getCurrentUser, onAuthStateChange, _resetAuthStateForTesting, verifyOtpForRecovery } from '../supabaseAuthProvider';
import { onBeforeAccountReload, skipFlushOnAccountReload, takeAccountChangeNotice } from '../accountReload';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { mapAIError } from '../../../features/ai/services/AIService';

describe('ERR-3: auth session error visibility and token refresh failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
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

  // Смена аккаунта во вкладке — перезагрузка (accountReload.ts). До неё
  // зеркало остаётся прежним: фоновая работа прежнего пишет в его базу.
  function mockLocation() {
    const reload = vi.fn();
    const assign = vi.fn();
    const orig = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...orig, reload, assign } });
    return { reload, assign, restore: () => Object.defineProperty(window, 'location', { configurable: true, value: orig }) };
  }
  function subscribe() {
    _resetAuthStateForTesting();
    const cbs: Array<(event: string, session: unknown) => void> = [];
    mockOnAuthStateChange.mockImplementation((cb: (event: string, session: unknown) => void) => {
      cbs.push(cb);
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    getCurrentUser();
    return (event: string, session: unknown) => { for (const cb of [...cbs]) cb(event, session); };
  }

  it('a voluntary sign-out is not reported, and the tab reloads instead of turning into a guest in place', async () => {
    const loc = mockLocation();
    try {
      const fire = subscribe();
      mockSignOut.mockImplementation(async () => { fire('SIGNED_OUT', null); return { error: null }; });
      fire('SIGNED_IN', { user: { id: 'u_test_1', email: 'test@example.com' } });
      expect(getCurrentUser()?.uid).toBe('u_test_1');

      await signOutUser();

      await vi.waitFor(() => expect(loc.reload).toHaveBeenCalledTimes(1));
      expect(getCurrentUser()?.uid).toBe('u_test_1');
      expect(reportErrorModule.reportError).not.toHaveBeenCalled();
    } finally { loc.restore(); }
  });

  it('an unexpected sign-out is reported, and the tab reloads', async () => {
    const loc = mockLocation();
    try {
      const fire = subscribe();
      fire('SIGNED_IN', { user: { id: 'u_test_2', email: 'test@example.com' } });
      fire('SIGNED_OUT', null);
      expect(reportErrorModule.reportError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('SESSION_TERMINATED') }),
        expect.objectContaining({ action: 'auth_session_signed_out', previousUid: 'u_test_2' }),
        'warning',
      );
      await vi.waitFor(() => expect(loc.reload).toHaveBeenCalledTimes(1));
    } finally { loc.restore(); }
  });

  it('any tab — visible too — reloads when the account changes; a token refresh does not', async () => {
    const loc = mockLocation();
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    try {
      const fire = subscribe();
      fire('SIGNED_IN', { user: { id: 'owner', email: 'a@example.com' } });
      fire('TOKEN_REFRESHED', { user: { id: 'owner', email: 'a@example.com' } });
      await Promise.resolve();
      expect(loc.reload).not.toHaveBeenCalled();

      fire('SIGNED_IN', { user: { id: 'invitee', email: 'b@example.com' } });
      await vi.waitFor(() => expect(loc.reload).toHaveBeenCalledTimes(1));
      expect(getCurrentUser()?.uid).toBe('owner');
    } finally { vis.mockRestore(); loc.restore(); }
  });

  it('signing in from a guest tab does not reload — the guest text moves into the account', async () => {
    const loc = mockLocation();
    try {
      const fire = subscribe();
      fire('SIGNED_IN', { user: { id: 'newbie', email: 'n@example.com' } });
      await Promise.resolve();
      expect(loc.reload).not.toHaveBeenCalled();
      expect(getCurrentUser()?.uid).toBe('newbie');
    } finally { loc.restore(); }
  });

  it('the screen never learns about the new account while the reload is pending', async () => {
    const loc = mockLocation();
    try {
      const fire = subscribe();
      const seen: Array<string | null> = [];
      onAuthStateChange(u => seen.push(u?.uid ?? null));
      fire('SIGNED_IN', { user: { id: 'owner', email: 'a@example.com' } });
      fire('SIGNED_IN', { user: { id: 'intruder', email: 'b@example.com' } });
      fire('SIGNED_OUT', null);
      expect(seen).toEqual(['owner']);
      await vi.waitFor(() => expect(loc.reload).toHaveBeenCalled());
    } finally { loc.restore(); }
  });

  it('the draft is saved to its owner before the reload, but not after a wipe', async () => {
    const loc = mockLocation();
    try {
      const fire = subscribe();
      const order: string[] = [];
      onBeforeAccountReload(async () => { await Promise.resolve(); order.push('flush'); });
      loc.reload.mockImplementation(() => order.push('reload'));
      fire('SIGNED_IN', { user: { id: 'owner', email: 'a@example.com' } });
      fire('SIGNED_OUT', null);
      await vi.waitFor(() => expect(order).toEqual(['flush', 'reload']));

      const fire2 = subscribe();
      const flushed = vi.fn(async () => {});
      onBeforeAccountReload(flushed);
      skipFlushOnAccountReload();
      fire2('SIGNED_IN', { user: { id: 'owner', email: 'a@example.com' } });
      fire2('SIGNED_OUT', null);
      await vi.waitFor(() => expect(loc.reload).toHaveBeenCalledTimes(2));
      expect(flushed).not.toHaveBeenCalled();
    } finally { loc.restore(); }
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
    localStorage.setItem('jw_voluntary_signout_at_u_tab', String(Date.now())); // соседняя вкладка нажала «Выйти»
    authStateCallback?.('SIGNED_OUT', null);
    expect(reportErrorModule.reportError).not.toHaveBeenCalled();
    localStorage.removeItem('jw_voluntary_signout_at_u_tab');
  });

  // N-58: одноразовая ссылка обменивается один раз, второй вызов получает тот же результат.
  it('exchanges a token_hash once, even when asked twice', async () => {
    mockVerifyOtp.mockResolvedValue({ data: { user: { email: 'inv@example.com' } }, error: null });
    const [a, b] = await Promise.all([verifyOtpForRecovery('h-once', 'invite'), verifyOtpForRecovery('h-once', 'invite')]);
    expect(a).toBe('inv@example.com');
    expect(b).toBe('inv@example.com');
    expect(mockVerifyOtp).toHaveBeenCalledTimes(1);
  });

  it('a failed exchange can be retried', async () => {
    mockVerifyOtp.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ data: { user: { email: 'r@example.com' } }, error: null });
    await expect(verifyOtpForRecovery('h-retry', 'recovery')).rejects.toThrow('network');
    await expect(verifyOtpForRecovery('h-retry', 'recovery')).resolves.toBe('r@example.com');
  });

  // N-60: выход одного аккаунта не заглушает обрыв сессии другого.
  it('a sign-out of another account does not hide an unexpected sign-out of this one', () => {
    _resetAuthStateForTesting();
    let cb: ((event: string, session: unknown) => void) | undefined;
    mockOnAuthStateChange.mockImplementation((f: (event: string, session: unknown) => void) => { cb = f; return { data: { subscription: { unsubscribe: vi.fn() } } }; });
    getCurrentUser();
    cb?.('SIGNED_IN', { user: { id: 'u_mine', email: 'm@example.com' } });
    localStorage.setItem('jw_voluntary_signout_at_u_other', String(Date.now()));
    cb?.('SIGNED_OUT', null);
    expect(reportErrorModule.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('SESSION_TERMINATED') }), expect.anything(), 'warning');
  });

  // S-28: нечаянный выход оставляет новое странице что предложить стереть.
  it('an unexpected sign-out records the lost-session notice and its uid', () => {
    _resetAuthStateForTesting();
    let cb: ((event: string, session: unknown) => void) | undefined;
    mockOnAuthStateChange.mockImplementation((f: (event: string, session: unknown) => void) => { cb = f; return { data: { subscription: { unsubscribe: vi.fn() } } }; });
    getCurrentUser();
    cb?.('SIGNED_IN', { user: { id: 'u_lost', email: 'l@example.com' } });
    cb?.('SIGNED_OUT', null);
    expect(takeAccountChangeNotice()).toBe('lost_session');
    expect(localStorage.getItem(STORAGE_KEYS.LOST_SESSION_UID)).toBe('u_lost');
    localStorage.removeItem(STORAGE_KEYS.LOST_SESSION_UID);
  });

  // S-33.3: устройство B открыто после истечения токена — supabase-js стирает
  // сессию и шлёт SIGNED_OUT до любого SIGNED_IN, currentUser ещё null.
  it('a stored session that dies during startup still records the lost-session uid', async () => {
    const loc = mockLocation();
    try {
      _resetAuthStateForTesting();
      localStorage.setItem('sb-mock-auth-token', JSON.stringify({ access_token: 'stale', user: { id: 'u_stale' } }));
      const fire = subscribe();
      localStorage.removeItem('sb-mock-auth-token'); // _removeSession стирает её до события
      fire('SIGNED_OUT', null);

      expect(takeAccountChangeNotice()).toBe('lost_session');
      expect(localStorage.getItem(STORAGE_KEYS.LOST_SESSION_UID)).toBe('u_stale');
      expect(reportErrorModule.reportError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('SESSION_TERMINATED') }),
        expect.objectContaining({ action: 'auth_session_signed_out', previousUid: 'u_stale' }),
        'warning',
      );
      // Вошедшего не было — перезагрузку просим сами, иначе новое предложение никто не прочтёт.
      await vi.waitFor(() => expect(loc.reload).toHaveBeenCalledTimes(1));
      localStorage.removeItem(STORAGE_KEYS.LOST_SESSION_UID);
    } finally { loc.restore(); }
  });

  it('the stored-session snapshot is spent by the first event: a later SIGNED_OUT of a guest tab records nothing', () => {
    _resetAuthStateForTesting();
    localStorage.setItem('sb-mock-auth-token', JSON.stringify({ access_token: 'ok', user: { id: 'u_fine' } }));
    const fire = subscribe();
    fire('INITIAL_SESSION', null);
    fire('SIGNED_OUT', null);
    expect(takeAccountChangeNotice()).not.toBe('lost_session');
    expect(localStorage.getItem(STORAGE_KEYS.LOST_SESSION_UID)).toBeNull();
  });

  it('a stored session that dies during startup right after a voluntary sign-out elsewhere records nothing', () => {
    _resetAuthStateForTesting();
    localStorage.setItem('sb-mock-auth-token', JSON.stringify({ access_token: 'stale', user: { id: 'u_left' } }));
    localStorage.setItem(STORAGE_KEYS.VOLUNTARY_SIGNOUT_AT('u_left'), String(Date.now()));
    const fire = subscribe();
    fire('SIGNED_OUT', null);
    expect(takeAccountChangeNotice()).not.toBe('lost_session');
    expect(localStorage.getItem(STORAGE_KEYS.LOST_SESSION_UID)).toBeNull();
  });

  // S-33.4: отметка добровольного выхода живёт 60 с; старые убирает старт, молодую — таймер.
  it('stale voluntary-signout marks are swept at subscription, fresh ones expire after 60 s', () => {
    vi.useFakeTimers();
    try {
      _resetAuthStateForTesting();
      localStorage.setItem(STORAGE_KEYS.VOLUNTARY_SIGNOUT_AT('u_old'), String(Date.now() - 61_000));
      localStorage.setItem(STORAGE_KEYS.VOLUNTARY_SIGNOUT_AT('u_almost'), String(Date.now() - 59_000));
      localStorage.setItem(STORAGE_KEYS.VOLUNTARY_SIGNOUT_AT('u_fresh'), String(Date.now() - 1_000));
      subscribe();
      expect(localStorage.getItem(STORAGE_KEYS.VOLUNTARY_SIGNOUT_AT('u_old'))).toBeNull();
      // S-60 (S-33.4): срок — ровно 60 с, не меньше: отметка в 59 с ещё жива.
      expect(localStorage.getItem(STORAGE_KEYS.VOLUNTARY_SIGNOUT_AT('u_almost'))).not.toBeNull();
      expect(localStorage.getItem(STORAGE_KEYS.VOLUNTARY_SIGNOUT_AT('u_fresh'))).not.toBeNull();
      vi.advanceTimersByTime(58_000);
      expect(localStorage.getItem(STORAGE_KEYS.VOLUNTARY_SIGNOUT_AT('u_fresh')), 'отметка снята раньше 60 с').not.toBeNull();
      vi.advanceTimersByTime(1_001);
      expect(localStorage.getItem(STORAGE_KEYS.VOLUNTARY_SIGNOUT_AT('u_fresh'))).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('a sign-out made in another tab records no wipe offer', () => {
    _resetAuthStateForTesting();
    let cb: ((event: string, session: unknown) => void) | undefined;
    mockOnAuthStateChange.mockImplementation((f: (event: string, session: unknown) => void) => { cb = f; return { data: { subscription: { unsubscribe: vi.fn() } } }; });
    getCurrentUser();
    cb?.('SIGNED_IN', { user: { id: 'u_given', email: 'g@example.com' } });
    localStorage.setItem(STORAGE_KEYS.VOLUNTARY_SIGNOUT_AT('u_given'), String(Date.now()));
    cb?.('SIGNED_OUT', null);
    expect(takeAccountChangeNotice()).not.toBe('lost_session');
    expect(localStorage.getItem(STORAGE_KEYS.LOST_SESSION_UID)).toBeNull();
    localStorage.removeItem(STORAGE_KEYS.VOLUNTARY_SIGNOUT_AT('u_given'));
  });
});
