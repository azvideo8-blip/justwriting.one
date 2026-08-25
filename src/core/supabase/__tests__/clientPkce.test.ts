// TEST-1 §1.2: the Supabase client is created with the PKCE auth flow.
import { describe, expect, it, vi, beforeEach } from 'vitest';

const createClientMock = vi.fn(() => ({ from: vi.fn() }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...a: unknown[]) => createClientMock(...(a as [])),
}));

const ENV = {
  VITE_SUPABASE_URL: 'https://example.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'anon',
};

async function importFresh() {
  vi.resetModules();
  return await import('../client');
}

describe('1.2 PKCE flow', () => {
  beforeEach(() => {
    createClientMock.mockClear();
    vi.stubEnv('VITE_SUPABASE_URL', ENV.VITE_SUPABASE_URL);
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', ENV.VITE_SUPABASE_ANON_KEY);
  });

  it('createClient receives flowType pkce and detectSessionInUrl', async () => {
    const mod = await importFresh();
    mod.getSupabase();

    expect(createClientMock).toHaveBeenCalledTimes(1);
    const opts = (createClientMock.mock.calls[0] as any[])[2] as { auth: Record<string, unknown> };
    expect(opts.auth.flowType).toBe('pkce');
    expect(opts.auth.detectSessionInUrl).toBe(true);
    expect(opts.auth.persistSession).toBe(true);
  });

  it('singleton: a second call does not re-create the client', async () => {
    const mod = await importFresh();
    mod.getSupabase();
    mod.getSupabase();
    expect(createClientMock).toHaveBeenCalledTimes(1);
  });
});
