// api/auth.ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface Session {
  uid: string;
  role: string;
  claims: Record<string, unknown>;
}

const b64urlToBuf = (s: string) =>
  Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Returns the session, or null. Never throws on malformed input. */
export function verifyJwt(token: string, secret: string): Session | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [head, body, sig] = parts as [string, string, string];

    const header = JSON.parse(b64urlToBuf(head).toString()) as Record<string, unknown>;
    if (header.alg !== 'HS256') return null;
    if (header.typ !== undefined && header.typ !== 'JWT') return null;

    const expected = createHmac('sha256', secret).update(`${head}.${body}`).digest();
    const actual = b64urlToBuf(sig);
    if (actual.length !== expected.length) return null;
    if (!timingSafeEqual(actual, expected)) return null;
    const claims = JSON.parse(b64urlToBuf(body).toString()) as Record<string, unknown>;
    if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) return null;
    if (typeof claims.sub !== 'string' || !claims.sub) return null;
    return { uid: claims.sub, role: String(claims.role ?? 'authenticated'), claims };
  } catch {
    return null;
  }
}

export function requireSession(req: import('node:http').IncomingMessage): Session | null {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) return null;
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error('SUPABASE_JWT_SECRET not configured');
  return verifyJwt(header.slice(7), secret);
}
