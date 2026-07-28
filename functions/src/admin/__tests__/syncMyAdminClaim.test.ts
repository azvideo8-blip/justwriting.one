import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-functions/v2/https', () => ({
  onCall: vi.fn((_opts: unknown, handler: Function) => handler),
  HttpsError: class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'HttpsError';
    }
  },
}));

vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn() }));

const docGet = vi.fn();
vi.mock('../../shared/firestore', () => ({
  getDb: vi.fn(() => ({ doc: vi.fn(() => ({ get: docGet })) })),
  FIRESTORE_DATABASE_ID: 'test-db',
}));

const getUser = vi.fn();
const setCustomUserClaims = vi.fn();
const revokeRefreshTokens = vi.fn();
vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({ getUser, setCustomUserClaims, revokeRefreshTokens })),
}));

import { syncMyAdminClaim } from '../syncMyAdminClaim';

const call = syncMyAdminClaim as unknown as (req: unknown) => Promise<{ changed: boolean; isAdmin: boolean }>;
const AUTHED = { auth: { uid: 'user-a' }, data: {} };

describe('syncMyAdminClaim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCustomUserClaims.mockResolvedValue(undefined);
    revokeRefreshTokens.mockResolvedValue(undefined);
  });

  it('rejects an unauthenticated caller', async () => {
    await expect(call({ auth: null, data: {} })).rejects.toThrow();
    expect(setCustomUserClaims).not.toHaveBeenCalled();
  });

  // The case that locked the first admin out: the console-set profile field is
  // the only record of their role, and no code path could ever grant the claim.
  it('grants the claim when the profile field says admin', async () => {
    docGet.mockResolvedValue({ exists: true, data: () => ({ role: 'admin' }) });
    getUser.mockResolvedValue({ customClaims: {} });

    await expect(call(AUTHED)).resolves.toEqual({ changed: true, isAdmin: true });
    expect(setCustomUserClaims).toHaveBeenCalledWith('user-a', { role: 'admin' });
  });

  it('preserves unrelated existing claims when granting', async () => {
    docGet.mockResolvedValue({ exists: true, data: () => ({ role: 'admin' }) });
    getUser.mockResolvedValue({ customClaims: { tier: 'pro' } });

    await call(AUTHED);
    expect(setCustomUserClaims).toHaveBeenCalledWith('user-a', { tier: 'pro', role: 'admin' });
  });

  // The whole security argument rests on this: a non-admin profile must never
  // yield a claim, whatever the caller sends.
  it('grants nothing when the profile field is not admin', async () => {
    docGet.mockResolvedValue({ exists: true, data: () => ({ role: 'user' }) });
    getUser.mockResolvedValue({ customClaims: {} });

    await expect(call(AUTHED)).resolves.toEqual({ changed: false, isAdmin: false });
    expect(setCustomUserClaims).not.toHaveBeenCalled();
  });

  it('grants nothing when the profile does not exist', async () => {
    docGet.mockResolvedValue({ exists: false, data: () => undefined });
    getUser.mockResolvedValue({ customClaims: {} });

    await expect(call(AUTHED)).resolves.toEqual({ changed: false, isAdmin: false });
    expect(setCustomUserClaims).not.toHaveBeenCalled();
  });

  it('revokes a stale admin claim when the profile field no longer says admin', async () => {
    docGet.mockResolvedValue({ exists: true, data: () => ({ role: 'user' }) });
    getUser.mockResolvedValue({ customClaims: { role: 'admin', tier: 'pro' } });

    await expect(call(AUTHED)).resolves.toEqual({ changed: true, isAdmin: false });
    expect(setCustomUserClaims).toHaveBeenCalledWith('user-a', { tier: 'pro' });
    expect(revokeRefreshTokens).toHaveBeenCalledWith('user-a');
  });

  it('is a no-op when field and claim already agree', async () => {
    docGet.mockResolvedValue({ exists: true, data: () => ({ role: 'admin' }) });
    getUser.mockResolvedValue({ customClaims: { role: 'admin' } });

    await expect(call(AUTHED)).resolves.toEqual({ changed: false, isAdmin: true });
    expect(setCustomUserClaims).not.toHaveBeenCalled();
    expect(revokeRefreshTokens).not.toHaveBeenCalled();
  });
});
