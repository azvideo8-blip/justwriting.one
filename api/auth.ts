// api/auth.ts
import { jwtVerify } from 'jose';

export interface Session {
  uid: string;
  role: string;
  claims: Record<string, unknown>;
}

/**
 * Returns the session, or null. Never throws on malformed input.
 *
 * Checks enforced via jose.jwtVerify:
 * 1. Algorithm: HS256 strictly.
 * 2. Audience: "authenticated" (Supabase user session tokens).
 * 3. Required claims: "exp" (expiry is mandatory) and "sub" (user id).
 * 4. Issuer: process.env.SUPABASE_JWT_ISS (if configured).
 * 5. Clock tolerance: 10 seconds.
 *
 * Crucially, rejecting tokens without a valid user `sub` prevents the public Supabase
 * `anon` key or `service_role` key (which share the same signing secret but lack a user `sub`)
 * from authenticating as a user session.
 */
export async function verifyJwt(token: string, secret: string): Promise<Session | null> {
  try {
    const secretKey = await crypto.subtle.importKey(
      'raw',
      Buffer.from(secret, 'utf-8'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const options: Parameters<typeof jwtVerify>[2] = {
      algorithms: ['HS256'],
      audience: 'authenticated',
      clockTolerance: 10,
      requiredClaims: ['exp', 'sub'],
    };
    if (process.env.SUPABASE_JWT_ISS) {
      options.issuer = process.env.SUPABASE_JWT_ISS;
    }
    const { payload } = await jwtVerify(token, secretKey, options);
    if (typeof payload.sub !== 'string' || !payload.sub) return null;
    return {
      uid: payload.sub,
      role: String(payload.role ?? 'authenticated'),
      claims: payload as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

export async function requireSession(req: import('node:http').IncomingMessage): Promise<Session | null> {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) return null;
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error('SUPABASE_JWT_SECRET not configured');
  return verifyJwt(header.slice(7), secret);
}
