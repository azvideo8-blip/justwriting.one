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

describe('JW-SEC-02: auth SUPABASE_JWT_SECRET handling', () => {
  const originalEnv = process.env.SUPABASE_JWT_SECRET;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.SUPABASE_JWT_SECRET = originalEnv;
    } else {
      delete process.env.SUPABASE_JWT_SECRET;
    }
  });

  it('requireSession throws Error if SUPABASE_JWT_SECRET is unset or empty', () => {
    delete process.env.SUPABASE_JWT_SECRET;
    const req = {
      headers: { authorization: 'Bearer some.jwt.token' },
    } as unknown as IncomingMessage;

    expect(() => requireSession(req)).toThrowError('SUPABASE_JWT_SECRET not configured');

    process.env.SUPABASE_JWT_SECRET = '';
    expect(() => requireSession(req)).toThrowError('SUPABASE_JWT_SECRET not configured');
  });

  it('requireSession returns null if authorization header is missing or not Bearer', () => {
    delete process.env.SUPABASE_JWT_SECRET;
    const reqNoAuth = { headers: {} } as unknown as IncomingMessage;
    expect(requireSession(reqNoAuth)).toBeNull();

    const reqBasic = { headers: { authorization: 'Basic 123' } } as unknown as IncomingMessage;
    expect(requireSession(reqBasic)).toBeNull();
  });

  it('requireSession validates token successfully when secret is configured', () => {
    process.env.SUPABASE_JWT_SECRET = 'super-secret-key';
    const token = makeToken(
      { alg: 'HS256', typ: 'JWT' },
      { sub: 'user-123', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 },
      'super-secret-key'
    );

    const req = {
      headers: { authorization: `Bearer ${token}` },
    } as unknown as IncomingMessage;

    const session = requireSession(req);
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

describe('JW-SEC-05: JWT algorithm validation (HS256 strictly, typ softly)', () => {
  const secret = 'test-secret';

  it('rejects token with alg: none', () => {
    const token = makeToken(
      { alg: 'none', typ: 'JWT' },
      { sub: 'user-1', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 },
      secret
    );
    expect(verifyJwt(token, secret)).toBeNull();
  });

  it('rejects token with alg: RS256', () => {
    const token = makeToken(
      { alg: 'RS256', typ: 'JWT' },
      { sub: 'user-1', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 },
      secret
    );
    expect(verifyJwt(token, secret)).toBeNull();
  });

  it('rejects token with invalid typ', () => {
    const token = makeToken(
      { alg: 'HS256', typ: 'INVALID_TYPE' },
      { sub: 'user-1', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 },
      secret
    );
    expect(verifyJwt(token, secret)).toBeNull();
  });

  it('accepts token without typ field (soft typ check)', () => {
    const token = makeToken(
      { alg: 'HS256' }, // no typ field
      { sub: 'user-1', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 },
      secret
    );
    const session = verifyJwt(token, secret);
    expect(session).not.toBeNull();
    expect(session?.uid).toBe('user-1');
  });

  it('safely returns null on malformed or garbage header without throwing', () => {
    expect(verifyJwt('garbage.body.sig', secret)).toBeNull();
    expect(verifyJwt('not-a-jwt', secret)).toBeNull();
    expect(verifyJwt('', secret)).toBeNull();
  });
});
