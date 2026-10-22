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

  // DA-20 / B-4: без запасного публичного адреса. Пока fallback вёл на
  // justwriting.ru, админ-вызовы ходили в GoTrue через интернет, и закрыть
  // /auth/v1/admin снаружи было нельзя. Адрес задаёт владелец в
  // /opt/justwriting/api/.env (шаг 1: http://127.0.0.1:8000).
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL not configured for admin calls');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
