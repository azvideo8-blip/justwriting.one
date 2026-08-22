import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { requireSession, verifyJwt } from '../auth';
import { handle } from '../dispatcher';

function makeToken(header: object, payload: object, secret: string): string {
  const b64url = (obj: object) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

  const head = b64url(header);
  const body = b64url(payload);
  const sig = createHmac('sha256', secret)
    .update(`${head}.${body}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${head}.${body}.${sig}`;
}

describe('JW-SEC-02 / SEC-3: auth SUPABASE_JWT_SECRET & claim validation', () => {
  const originalEnvSecret = process.env.SUPABASE_JWT_SECRET;
  const originalEnvIss = process.env.SUPABASE_JWT_ISS;

  afterEach(() => {
    if (originalEnvSecret !== undefined) {
      process.env.SUPABASE_JWT_SECRET = originalEnvSecret;
    } else {
      delete process.env.SUPABASE_JWT_SECRET;
    }
    if (originalEnvIss !== undefined) {
      process.env.SUPABASE_JWT_ISS = originalEnvIss;
    } else {
      delete process.env.SUPABASE_JWT_ISS;
    }
  });

  it('requireSession throws Error if SUPABASE_JWT_SECRET is unset or empty', async () => {
    delete process.env.SUPABASE_JWT_SECRET;
    const req = {
      headers: { authorization: 'Bearer some.jwt.token' },
    } as unknown as IncomingMessage;

    await expect(requireSession(req)).rejects.toThrowError('SUPABASE_JWT_SECRET not configured');

    process.env.SUPABASE_JWT_SECRET = '';
    await expect(requireSession(req)).rejects.toThrowError('SUPABASE_JWT_SECRET not configured');
  });

  it('requireSession returns null if authorization header is missing or not Bearer', async () => {
    delete process.env.SUPABASE_JWT_SECRET;
    const reqNoAuth = { headers: {} } as unknown as IncomingMessage;
    expect(await requireSession(reqNoAuth)).toBeNull();

    const reqBasic = { headers: { authorization: 'Basic 123' } } as unknown as IncomingMessage;
    expect(await requireSession(reqBasic)).toBeNull();
  });

  it('requireSession validates token successfully when secret is configured', async () => {
    process.env.SUPABASE_JWT_SECRET = 'super-secret-key';
    const token = makeToken(
      { alg: 'HS256', typ: 'JWT' },
      { sub: 'user-123', role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 },
      'super-secret-key'
    );

    const req = {
      headers: { authorization: `Bearer ${token}` },
    } as unknown as IncomingMessage;

    const session = await requireSession(req);
    expect(session).not.toBeNull();
    expect(session?.uid).toBe('user-123');
    expect(session?.role).toBe('authenticated');
  });

  it('dispatcher returns 500 when SUPABASE_JWT_SECRET is missing on authenticated endpoint call', async () => {
    delete process.env.SUPABASE_JWT_SECRET;

    let responseStatus = 0;
    let responseBody = '';

    const req = {
      method: 'POST',
      url: '/api/chatWithAI',
      headers: { authorization: 'Bearer some.token' },
      on: vi.fn(),
    } as unknown as IncomingMessage;

    const res = {
      writeHead: vi.fn((status: number) => {
        responseStatus = status;
      }),
      end: vi.fn((body: string) => {
        responseBody = body;
      }),
    } as unknown as ServerResponse;

    await handle(req, res);

    expect(responseStatus).toBe(500);
    expect(JSON.parse(responseBody)).toEqual({ error: 'Internal server error' });
  });

  it('dispatcher returns 401 when token is invalid or unsigned', async () => {
    process.env.SUPABASE_JWT_SECRET = 'correct-secret';

    let responseStatus = 0;
    let responseBody = '';

    const req = {
      method: 'POST',
      url: '/api/chatWithAI',
      headers: { authorization: 'Bearer invalid.token' },
      on: vi.fn(),
    } as unknown as IncomingMessage;

    const res = {
      writeHead: vi.fn((status: number) => {
        responseStatus = status;
      }),
      end: vi.fn((body: string) => {
        responseBody = body;
      }),
    } as unknown as ServerResponse;

    await handle(req, res);

    expect(responseStatus).toBe(401);
    expect(JSON.parse(responseBody)).toEqual({ error: 'Unauthenticated' });
  });
});

describe('SEC-3: JWT claims and algorithm verification via jose', () => {
  const secret = 'test-secret-at-least-32-chars-long-security';

  it('rejects token with valid signature and NO exp claim', async () => {
    const token = makeToken(
      { alg: 'HS256', typ: 'JWT' },
      { sub: 'user-1', aud: 'authenticated', role: 'authenticated' },
      secret
    );
    expect(await verifyJwt(token, secret)).toBeNull();
  });

  it('rejects token with aud: "other" and accepts with aud: "authenticated"', async () => {
    const tokenOther = makeToken(
      { alg: 'HS256', typ: 'JWT' },
      { sub: 'user-1', aud: 'other', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 },
      secret
    );
    expect(await verifyJwt(tokenOther, secret)).toBeNull();

    const tokenAuth = makeToken(
      { alg: 'HS256', typ: 'JWT' },
      { sub: 'user-1', aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 },
      secret
    );
    const session = await verifyJwt(tokenAuth, secret);
    expect(session).not.toBeNull();
    expect(session?.uid).toBe('user-1');
  });

  it('rejects the Supabase anon key (signed with secret, role: anon, but NO sub)', async () => {
    const anonToken = makeToken(
      { alg: 'HS256', typ: 'JWT' },
      { role: 'anon', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 * 24 * 365 },
      secret
    );
    expect(await verifyJwt(anonToken, secret)).toBeNull();
  });

  it('rejects token expired in the past beyond clock tolerance', async () => {
    const expiredToken = makeToken(
      { alg: 'HS256', typ: 'JWT' },
      { sub: 'user-1', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) - 60 },
      secret
    );
    expect(await verifyJwt(expiredToken, secret)).toBeNull();
  });

  it('accepts token 5 seconds past expiry due to clock tolerance 10s', async () => {
    const nearExpiredToken = makeToken(
      { alg: 'HS256', typ: 'JWT' },
      { sub: 'user-1', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) - 5 },
      secret
    );
    const session = await verifyJwt(nearExpiredToken, secret);
    expect(session).not.toBeNull();
    expect(session?.uid).toBe('user-1');
  });

  it('validates issuer when SUPABASE_JWT_ISS is configured', async () => {
    process.env.SUPABASE_JWT_ISS = 'https://justwriting.ru/auth/v1';

    const tokenWrongIss = makeToken(
      { alg: 'HS256', typ: 'JWT' },
      { sub: 'user-1', aud: 'authenticated', iss: 'https://evil.com/auth/v1', exp: Math.floor(Date.now() / 1000) + 3600 },
      secret
    );
    expect(await verifyJwt(tokenWrongIss, secret)).toBeNull();

    const tokenCorrectIss = makeToken(
      { alg: 'HS256', typ: 'JWT' },
      { sub: 'user-1', aud: 'authenticated', iss: 'https://justwriting.ru/auth/v1', exp: Math.floor(Date.now() / 1000) + 3600 },
      secret
    );
    const session = await verifyJwt(tokenCorrectIss, secret);
    expect(session).not.toBeNull();
    expect(session?.uid).toBe('user-1');
  });

  it('rejects token with alg: none', async () => {
    const token = makeToken(
      { alg: 'none', typ: 'JWT' },
      { sub: 'user-1', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 },
      secret
    );
    expect(await verifyJwt(token, secret)).toBeNull();
  });

  it('rejects token with alg: RS256', async () => {
    const token = makeToken(
      { alg: 'RS256', typ: 'JWT' },
      { sub: 'user-1', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 },
      secret
    );
    expect(await verifyJwt(token, secret)).toBeNull();
  });

  it('safely returns null on malformed or garbage header without throwing', async () => {
    expect(await verifyJwt('garbage.body.sig', secret)).toBeNull();
    expect(await verifyJwt('not-a-jwt', secret)).toBeNull();
    expect(await verifyJwt('', secret)).toBeNull();
  });
});

describe('AG-SEC-D: SUPABASE_JWT_ISS production requirement', () => {
  const origNodeEnv = process.env.NODE_ENV;
  const origIss = process.env.SUPABASE_JWT_ISS;
  const origDbUrl = process.env.DATABASE_URL;

  afterEach(() => {
    process.env.NODE_ENV = origNodeEnv;
    if (origIss !== undefined) process.env.SUPABASE_JWT_ISS = origIss;
    else delete process.env.SUPABASE_JWT_ISS;
    if (origDbUrl !== undefined) process.env.DATABASE_URL = origDbUrl;
    else delete process.env.DATABASE_URL;
    vi.resetModules();
  });

  it('throws on module load in production when SUPABASE_JWT_ISS is absent', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SUPABASE_JWT_ISS;
    vi.resetModules();

    await expect(import('../auth')).rejects.toThrow('SUPABASE_JWT_ISS is required in production');
  });

  it('throws when NODE_ENV is unset/empty but DATABASE_URL is set and SUPABASE_JWT_ISS is absent', async () => {
    process.env.NODE_ENV = '';
    process.env.DATABASE_URL = 'postgresql://localhost:5432/justwriting';
    delete process.env.SUPABASE_JWT_ISS;
    vi.resetModules();

    await expect(import('../auth')).rejects.toThrow('SUPABASE_JWT_ISS is required in production');
  });

  it('does not throw under test environment without SUPABASE_JWT_ISS', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.SUPABASE_JWT_ISS;
    vi.resetModules();

    await expect(import('../auth')).resolves.toBeDefined();
  });
});

