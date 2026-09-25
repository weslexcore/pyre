// Browser-side Supabase client for React islands: acts as the signed-in staff
// member, so every query is filtered by RLS (public.is_admin(),
// public.staff_can_view(), …). Shares the session cookie the server client
// writes (see ./server.ts) — same fixed name, readable from JS by design.

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_AUTH_COOKIE = 'pyre_sb';

let client: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (client) return client;

  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const key = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error('PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_PUBLISHABLE_KEY are not configured');
  }

  client = createBrowserClient(url, key, {
    cookieOptions: { name: SUPABASE_AUTH_COOKIE, path: '/', sameSite: 'lax' },
  });
  return client;
}
