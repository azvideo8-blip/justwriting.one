// api/auth.ts
import { jwtVerify } from 'jose';

export interface Session {
  uid: string;
  role: string;
  claims: Record<string, unknown>;
}

// Проверка издателя обязательна в продакшене. Раньше отсутствие переменной
// просто отключало её — деплой без строки в .env выглядел бы полностью
// исправным, принимая любой токен, подписанный общим секретом.
const JWT_ISSUER = process.env.SUPABASE_JWT_ISS;
const isProd = process.env.NODE_ENV === 'production' || (process.env.NODE_ENV !== 'test' && Boolean(process.env.DATABASE_URL));
if (isProd && !JWT_ISSUER) {
  throw new Error(
    'SUPABASE_JWT_ISS is required in production: without it any token signed ' +
    'with the shared secret is accepted regardless of who issued it.',
  );
}

/**
 * Returns the session, or null. Never throws on malformed input.
 *
 * Checks enforced via jose.jwtVerify:
 * 1. Algorithm: HS256 strictly.
 * 2. Audience: "authenticated" (Supabase user session tokens).
 * 3. Required claims: "exp" (expiry is mandatory) and "sub" (user id).
 * 4. Issuer: process.env.SUPABASE_JWT_ISS (mandatory in production).
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
    const issuer = process.env.SUPABASE_JWT_ISS;
    if (issuer) {
      options.issuer = issuer;
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

/**
 * AUD-20: удаление аккаунта необратимо, поэтому клиент требует пароль заново
 * (`reauthenticate` перед вызовом). Клиентская проверка закрывает одолженный
 * разблокированный ноутбук, но не украденный токен — тот ходит в API напрямую,
 * мимо любого экрана. Сервер судит по claim'у `amr`, который GoTrue кладёт в
 * токен: там записано, каким методом и КОГДА человек аутентифицировался,
 * и обновление токена по refresh-токену эту отметку не двигает.
 *
 * Если `amr` в токене нет (старая или иначе собранная сборка GoTrue), гейт
 * пропускает: сломать удаление аккаунта всем ради проверки, которой может не
 * быть данных, хуже, чем оставить здесь клиентскую защиту. Отсутствие claim'а
 * подделать нельзя — токен подписан.
 */
export function passwordRecentlyVerified(session: Session, maxAgeSec = 300): boolean {
  const amr = session.claims.amr;
  if (!Array.isArray(amr) || amr.length === 0) return true; // claim не выдаётся — судить нечем
  const now = Math.floor(Date.now() / 1000);
  return amr.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    if (method !== 'password') return false;
    if (typeof timestamp !== 'number') return false;
    return now - timestamp <= maxAgeSec;
  });
}

export async function requireSession(req: import('node:http').IncomingMessage): Promise<Session | null> {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) return null;
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error('SUPABASE_JWT_SECRET not configured');
  return verifyJwt(header.slice(7), secret);
}
