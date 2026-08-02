import { describe, it, expect, vi, beforeEach } from 'vitest';

const callable = vi.fn();
const getIdToken = vi.fn();
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: () => callable,
}));
vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: { uid: 'u1', getIdToken } }),
}));
vi.mock('../../../../shared/errors/reportError', () => ({
  reportError: vi.fn(),
}));

import { AIService } from '../AIService';

// N3: when chat fails with AUTH_REQUIRED and the user is signed in, the token
// has probably expired silently (securetoken was down, call went out without a
// valid token, function refused). One forced refresh + retry is the right fix.
describe('chat retries once after token refresh on AUTH_REQUIRED', () => {
  beforeEach(() => {
    callable.mockReset();
    getIdToken.mockReset();
    getIdToken.mockResolvedValue('fresh-token');
  });

  it('refreshes token and retries on AUTH_REQUIRED when user is signed in', async () => {
    callable
      .mockRejectedValueOnce(Object.assign(new Error('unauthenticated'), { code: 'functions/unauthenticated' }))
      .mockResolvedValueOnce({ data: { result: 'hello' } });

    const res = await AIService.chat({ personaId: 'p1', messages: [] });

    expect(getIdToken).toHaveBeenCalledWith(true);
    expect(getIdToken).toHaveBeenCalledTimes(1);
    expect(callable).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.text).toBe('hello');
  });

  it('does not retry a second time on consecutive AUTH_REQUIRED', async () => {
    callable
      .mockRejectedValueOnce(Object.assign(new Error('unauthenticated'), { code: 'functions/unauthenticated' }))
      .mockRejectedValueOnce(Object.assign(new Error('unauthenticated'), { code: 'functions/unauthenticated' }));

    const res = await AIService.chat({ personaId: 'p1', messages: [] });

    // getIdToken called once for the first retry; the second failure is final.
    expect(getIdToken).toHaveBeenCalledTimes(1);
    expect(callable).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('AUTH_REQUIRED');
  });

  it('does not retry when there is no current user', async () => {
    // Temporarily override getAuth to return no user.
    const { getAuth: _getAuth } = await import('firebase/auth');
    const mod = await import('firebase/auth');
    // Replace the mock for this test only.
    vi.mocked(mod).getAuth = () => ({ currentUser: null }) as ReturnType<typeof mod.getAuth>;

    callable.mockRejectedValueOnce(Object.assign(new Error('unauthenticated'), { code: 'functions/unauthenticated' }));

    const res = await AIService.chat({ personaId: 'p1', messages: [] });

    expect(getIdToken).not.toHaveBeenCalled();
    expect(callable).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('AUTH_REQUIRED');

    // Restore.
    vi.mocked(mod).getAuth = _getAuth;
  });
});
