/**
 * EA-15: сервер авторизации не должен видеть пароль, из которого строится ключ
 * сейфа. Человек вводит один пароль; браузер выводит из него отдельное значение
 * для входа, и только оно уходит в GoTrue. Ключ сейфа по-прежнему выводится
 * из самого пароля с солью сейфа (EncryptionService) — соль и домен здесь
 * другие, поэтому из секрета входа ключ сейфа не получить. Схема та же, что у
 * Bitwarden/1Password.
 *
 * Не защищает от сервера, который отдаст подменённый код приложения: такой код
 * перехватит пароль в браузере. Это ограничение любого веб-приложения.
 */

const ITERATIONS = 600_000;

export function authSalt(email: string): string {
  return `justwriting-auth|${email.trim().toLowerCase()}`;
}

export async function deriveAuthSecret(password: string, email: string, iterations = ITERATIONS): Promise<string> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(authSalt(email)), iterations },
    baseKey,
    256,
  );
  return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
}
