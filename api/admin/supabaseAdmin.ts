import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let customAdminClient: SupabaseClient | null = null;

export function setSupabaseAdminForTesting(client: SupabaseClient | null): void {
  customAdminClient = client;
}

export function getSupabaseAdmin(): SupabaseClient {
  if (customAdminClient) return customAdminClient;

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://justwriting.ru';

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
