import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Created on first use, not at import time.
//
// createClient() throws when the URL is missing, so building it at module scope
// makes this file — and everything that transitively imports it — impossible to
// load wherever the env is not set. That is not a hypothetical: it took out 40
// test files at once and dropped the suite from 988 tests to 612, because a
// module that throws while importing takes its whole dependency tree with it.
//
// The same shape caused the same failure in core/auth with getAuth(app) at
// module scope. Construct lazily; let the throw happen at the call that needs a
// client, where it is attributable.
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    );
  }
  client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // PKCE вместо implicit: токены обмена по ссылкам не попадают во
      // фрагмент URL и дальше в Referer/историю. Парольный вход не затронут.
      flowType: 'pkce',
      detectSessionInUrl: true,
    },
  });
  return client;
}
