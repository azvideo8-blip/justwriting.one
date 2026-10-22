// B-4: админ-клиент GoTrue больше не падает в публичный адрес по умолчанию.
import { describe, it, expect, afterEach } from 'vitest';
import { getSupabaseAdmin, setSupabaseAdminForTesting } from '../admin/supabaseAdmin';

const originalUrl = process.env.SUPABASE_URL;

afterEach(() => {
  setSupabaseAdminForTesting(null);
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
});

describe('B-4: SUPABASE_URL обязателен', () => {
  it('без SUPABASE_URL — понятная ошибка, а не публичный justwriting.ru', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    delete process.env.SUPABASE_URL;
    expect(() => getSupabaseAdmin()).toThrow(/SUPABASE_URL not configured/);
  });

  it('с внутренним адресом клиент создаётся', () => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:8000';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    expect(() => getSupabaseAdmin()).not.toThrow();
  });
});
