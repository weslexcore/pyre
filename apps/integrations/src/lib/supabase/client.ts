// The browser's Supabase client, for Realtime. One per JS realm: module
// scope survives ClientRouter navigations, so the websocket stays up while
// header islands remount from page to page.
//
// It holds no session of its own. The server keeps the refresh token in an
// httpOnly cookie; the browser only ever receives the short-lived access
// token, from /api/auth/realtime-token, and hands it to realtime.setAuth()
// so private channels can check RLS against the signed-in person. Nothing
// here queries a table.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null | undefined;

/** The shared client, or null when the public Supabase env is not set. */
export function getBrowserSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const key = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  client =
    url && key
      ? createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        })
      : null;
  return client;
}
