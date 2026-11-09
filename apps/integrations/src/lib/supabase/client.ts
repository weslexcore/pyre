// The browser's Supabase client, for Realtime. One per JS realm: module
// scope survives ClientRouter navigations, so the websocket stays up while
// header islands remount from page to page.
//
// It holds no session of its own. The server keeps the refresh token in an
// httpOnly cookie; the browser only ever receives the short-lived access
// token, from /api/auth/realtime-token, and hands it to realtime.setAuth()
// so private channels can check RLS against the signed-in person. The
// project URL and publishable key arrive in that same response (Astro only
// inlines PUBLIC_ env into islands, and these need no twin), so the client
// is built from them. Nothing here queries a table.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: { url: string; key: string; instance: SupabaseClient } | null = null;

/** The shared client for this project, built on first use. */
export function getBrowserSupabase(url: string, key: string): SupabaseClient {
  if (client && client.url === url && client.key === key) return client.instance;
  const instance = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  client = { url, key, instance };
  return instance;
}
