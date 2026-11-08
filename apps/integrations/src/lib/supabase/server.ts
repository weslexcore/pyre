// The Supabase client behind a visitor's session. Two clients, two keys, two
// jobs:
//
//   - getDb() in lib/db.ts is the service-role client: bypasses RLS, does
//     every data read and write, and is unchanged by any of this.
//   - createSupabaseServerClient(cookies) here is the publishable-key client
//     bound to the request's session cookies, used for auth only — reading
//     the signed-in user's claims, sending and verifying the magic link,
//     signing out. It never queries a table.
//
// The session lives in httpOnly cookies written by @supabase/ssr through the
// adapter below; the browser never holds the refresh token. Astro's cookie
// jar cannot enumerate names, so the cookie name is pinned (it doubles as the
// storage key) and the adapter probes it plus the chunk suffixes @supabase/ssr
// uses when a session outgrows one cookie.

import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AstroCookies } from 'astro';

export const SESSION_COOKIE = 'pyre-sb';
const MAX_CHUNKS = 10;

type CookieSetOptions = NonNullable<Parameters<AstroCookies['set']>[2]>;

/** Every name the session may be stored under: the base, then its chunks. */
export function sessionCookieNames(): string[] {
  return [
    SESSION_COOKIE,
    ...Array.from({ length: MAX_CHUNKS }, (_, i) => `${SESSION_COOKIE}.${i}`),
  ];
}

/** URL and publishable key, or null when sign-in is not configured. */
export function supabasePublicConfig(): { url: string; key: string } | null {
  const url = import.meta.env.PUBLIC_SUPABASE_URL ?? import.meta.env.SUPABASE_URL;
  const key = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

/** Cheap pre-check so anonymous requests never build a client. */
export function hasSessionCookie(cookies: AstroCookies): boolean {
  return cookies.has(SESSION_COOKIE) || cookies.has(`${SESSION_COOKIE}.0`);
}

let warnedUnconfigured = false;

export function createSupabaseServerClient(cookies: AstroCookies): SupabaseClient | null {
  const config = supabasePublicConfig();
  if (!config) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn(
        '[Auth] Supabase Auth not configured (PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_PUBLISHABLE_KEY)'
      );
    }
    return null;
  }

  return createServerClient(config.url, config.key, {
    // The server does every exchange (token_hash from the link, the 6-digit
    // code), so there is no PKCE verifier to park in a cookie.
    auth: { flowType: 'implicit' },
    cookieOptions: {
      name: SESSION_COOKIE,
      httpOnly: true,
      secure: import.meta.env.PROD,
      sameSite: 'lax',
      path: '/',
    },
    cookies: {
      getAll() {
        const found: { name: string; value: string }[] = [];
        for (const name of sessionCookieNames()) {
          const value = cookies.get(name)?.value;
          if (value !== undefined) found.push({ name, value });
        }
        return found;
      },
      setAll(list) {
        // A refreshed session or a sign-out arrives here as writes (and
        // max-age 0 removals); Astro attaches them to the response.
        for (const { name, value, options } of list) {
          cookies.set(name, value, options as CookieSetOptions);
        }
      },
    },
  });
}
