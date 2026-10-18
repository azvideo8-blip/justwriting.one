import { describe, it, expect, vi, beforeEach } from 'vitest';

const auth = {
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  signUp: vi.fn(),
  getUser: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
};
vi.mock('../../supabase/client', () => ({ getSupabase: () => ({ auth }) }));

import { deriveAuthSecret } from '../authSecret';
import { signIn, reauthenticate, updateUserPassword } from '../supabaseAuthProvider';

// EA-15: сервер авторизации не должен получать пароль, из которого строится
// ключ сейфа, — только производный секрет.
describe('auth secret: the password never reaches the server (EA-15)', () => {
  const email = 'Anna@Example.com ';
  const password = 'TihoeUtro-2026';
  const user = { id: 'u1', email: 'anna@example.com', user_metadata: {}, app_metadata: {} };
  let secret: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    secret = await deriveAuthSecret(password, email);
  });

  it('derives a stable 64-hex secret that ignores e-mail case and spaces', async () => {
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(await deriveAuthSecret(password, 'anna@example.com')).toBe(secret);
    expect(secret).not.toContain(password);
  });

  it('signs in with the secret, not the password', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user }, error: null });
    await signIn(email, password);
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email, password: secret });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('migrates a pre-EA-15 account: raw password accepted once, then replaced by the secret', async () => {
    auth.signInWithPassword
      .mockResolvedValueOnce({ data: { user: null }, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } })
      .mockResolvedValueOnce({ data: { user }, error: null });
    auth.updateUser.mockResolvedValue({ error: null });

    await signIn(email, password);

    expect(auth.signInWithPassword).toHaveBeenNthCalledWith(1, { email, password: secret });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: secret });
  });

  it('a wrong password fails without changing anything on the server', async () => {
    const bad = { code: 'invalid_credentials', message: 'Invalid login credentials' };
    auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: bad });
    await expect(signIn(email, 'wrong-password')).rejects.toBe(bad);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('does not fall back to the raw password on other errors (rate limit)', async () => {
    const limited = { code: 'over_request_rate_limit', message: 'Too many requests', status: 429 };
    auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: limited });
    await expect(signIn(email, password)).rejects.toBe(limited);
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it('re-authentication before account deletion sends the secret', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user }, error: null });
    await reauthenticate(email, password);
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email, password: secret });
  });

  it('setting a new password (reset link, invite, settings) sends the secret', async () => {
    auth.getUser.mockResolvedValue({ data: { user } });
    auth.updateUser.mockResolvedValue({ error: null });
    await updateUserPassword(password);
    expect(auth.updateUser).toHaveBeenCalledWith({ password: secret });
  });

  // 0.10.3: «нет ответа» ≠ «нет». Неверный пароль — REAUTH_FAILED; сбой сети или
  // лимит — исходная ошибка (иначе экран говорил «неверный пароль» при обрыве).
  // Мутация: любой error → REAUTH_FAILED — второй кейс красный.
  it('re-auth: wrong password is REAUTH_FAILED, a network failure is not', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } });
    await expect(reauthenticate(email, password)).rejects.toThrow('REAUTH_FAILED');
    const offline = { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 };
    auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: offline });
    await expect(reauthenticate(email, password)).rejects.toMatchObject({ message: 'Failed to fetch' });
  });
});
