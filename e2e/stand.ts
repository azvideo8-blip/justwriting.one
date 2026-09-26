// Помощники стенда (scripts/stand/up.sh): пользователи и ссылки через админ-API
// GoTrue. Пароли и адреса — сгенерированные, на каждый прогон свои.
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function env(): Record<string, string> {
  const text = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../scripts/stand/.env.stand'), 'utf8');
  return Object.fromEntries(text.split('\n').filter(Boolean).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
}

const E = env();
export const STAND_URL = E.STAND_URL!;
const GOTRUE = E.STAND_GOTRUE_URL!;
const SERVICE = E.SERVICE_KEY!;

/** То же, что src/core/auth/authSecret.ts: в GoTrue уходит не пароль, а производное. */
export function deriveAuthSecret(password: string, email: string): string {
  const salt = `justwriting-auth|${email.trim().toLowerCase()}`;
  return pbkdf2Sync(password, salt, 600_000, 32, 'sha256').toString('hex');
}

export function freshEmail(tag: string): string {
  return `${tag}-${randomBytes(4).toString('hex')}@stand.test`;
}

export function freshPassword(): string {
  return `Pw-${randomBytes(9).toString('base64url')}`;
}

async function admin(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${GOTRUE}/admin/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`GoTrue ${path} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

export async function createUser(tag: string): Promise<{ email: string; password: string; uid: string }> {
  const email = freshEmail(tag);
  const password = freshPassword();
  const u = await admin('users', { email, password: deriveAuthSecret(password, email), email_confirm: true });
  return { email, password, uid: String(u.id) };
}

/** Ссылка из письма без почты: token_hash для /reset-password?token_hash=…&type=… */
export async function generateLink(type: 'invite' | 'recovery', email: string): Promise<string> {
  const r = await admin('generate_link', { type, email });
  const token = (r.hashed_token ?? (r.properties as Record<string, unknown> | undefined)?.hashed_token) as string | undefined;
  if (!token) throw new Error(`generate_link: нет hashed_token в ответе ${JSON.stringify(r)}`);
  return token;
}
