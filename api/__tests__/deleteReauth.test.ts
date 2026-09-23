// AUD-20 (доводка): пароль спрашивался только на клиенте. Живой токен, взятый
// в обход экрана, всё ещё стирал архив одним POST. Сервер судит по claim'у
// `amr`: там метод и время аутентификации, и refresh их не двигает.
// Фальсификация: заставить passwordRecentlyVerified возвращать true всегда —
// тест на просроченную отметку краснеет.
import { describe, expect, it } from 'vitest';
import { passwordRecentlyVerified, type Session } from '../auth';

const now = () => Math.floor(Date.now() / 1000);

const session = (claims: Record<string, unknown>): Session => ({
  uid: 'u1', role: 'authenticated', claims,
});

describe('AUD-20 server-side re-auth gate', () => {
  it('accepts a password entered a moment ago', () => {
    expect(passwordRecentlyVerified(
      session({ amr: [{ method: 'password', timestamp: now() - 10 }] }),
    )).toBe(true);
  });

  it('refuses a session whose password was entered an hour ago', () => {
    expect(passwordRecentlyVerified(
      session({ amr: [{ method: 'password', timestamp: now() - 3600 }] }),
    )).toBe(false);
  });

  it('refuses when the session was authenticated by another method only', () => {
    expect(passwordRecentlyVerified(
      session({ amr: [{ method: 'magiclink', timestamp: now() }] }),
    )).toBe(false);
  });

  it('refuses deletion when the token carries no amr claim (EA-12)', () => {
    // Удаление необратимо: «не знаю, когда вводили пароль» означает «нет».
    // GoTrue (v2.189, v2.196) выдаёт amr всегда.
    expect(passwordRecentlyVerified(session({}))).toBe(false);
  });
});
