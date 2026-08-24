import { describe, it, expect } from 'vitest';
import { mapSupabaseAuthError } from '../pages/LoginPage';

// Заглушка переводчика: возвращает сам ключ. Тест проверяет, КАКОЙ ключ
// выбран маппером, а не текст перевода.
const t = (key: string) => key;

describe('mapSupabaseAuthError — коды Supabase Auth (AUD-10)', () => {
  it('invalid_credentials → auth_error_invalid_credential', () => {
    const err = Object.assign(new Error('Invalid login credentials'), { code: 'invalid_credentials', status: 400 });
    expect(mapSupabaseAuthError(err, t)).toBe('auth_error_invalid_credential');
  });

  it('user_already_exists → auth_error_email_in_use', () => {
    const err = Object.assign(new Error('User already registered'), { code: 'user_already_exists', status: 422 });
    expect(mapSupabaseAuthError(err, t)).toBe('auth_error_email_in_use');
  });

  it('weak_password → auth_error_weak_password', () => {
    const err = Object.assign(new Error('Password should be at least 6 characters'), { code: 'weak_password', status: 422 });
    expect(mapSupabaseAuthError(err, t)).toBe('auth_error_weak_password');
  });

  it('email_not_confirmed → auth_error_email_not_confirmed', () => {
    const err = Object.assign(new Error('Email not confirmed'), { code: 'email_not_confirmed', status: 400 });
    expect(mapSupabaseAuthError(err, t)).toBe('auth_error_email_not_confirmed');
  });

  it('over_request_rate_limit → auth_error_rate_limited (по коду, без status)', () => {
    const err = Object.assign(new Error('Over request rate limit'), { code: 'over_request_rate_limit' });
    expect(mapSupabaseAuthError(err, t)).toBe('auth_error_rate_limited');
  });

  it('status 429 → auth_error_rate_limited даже без кода', () => {
    const err = Object.assign(new Error('Too many requests'), { status: 429 });
    expect(mapSupabaseAuthError(err, t)).toBe('auth_error_rate_limited');
  });

  it('request_timeout → auth_error_network', () => {
    const err = Object.assign(new Error('Request timed out'), { code: 'request_timeout' });
    expect(mapSupabaseAuthError(err, t)).toBe('auth_error_network');
  });

  it('неизвестная ошибка → auth_error_generic', () => {
    const err = new Error('Something else');
    expect(mapSupabaseAuthError(err, t)).toBe('auth_error_generic');
  });

  // Легаси-коды Firebase Supabase не присылает никогда; маппер не должен
  // отвечать на них специфичным сообщением — иначе тест на реальном ответе
  // соврёт.
  it('легаси-код auth/wrong-password НЕ распознаётся', () => {
    const err = Object.assign(new Error('The password is invalid'), { code: 'auth/wrong-password' });
    expect(mapSupabaseAuthError(err, t)).toBe('auth_error_generic');
  });
});
