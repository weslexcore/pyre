// Per-request Supabase client acting as the signed-in staff member (anon /
// publishable key + their session cookie), so RLS applies. Distinct from
// getDb() in lib/db.ts, which holds the secret key and bypasses RLS for
// server jobs and the auth.admin calls in lib/auth/provision.ts.
//
// AstroCookies has no getAll(), so the session cookie gets a fixed name and
// getAll() reads it (plus @supabase/ssr's numbered chunks) back by name. The
// fixed name also means validateSession() only needs `cookies`, like the
// Momence session it replaces.

import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AstroCookies } from 'astro';

/** Session cookie name; @supabase/ssr splits big sessions into NAME.0, NAME.1, … */
export const SUPABASE_AUTH_COOKIE = 'pyre_sb';

// A session JWT plus refresh token fits in one or two 3180-byte chunks;
// ten leaves room for a fat user_metadata without reading unbounded names.
const MAX_CHUNKS = 10;

const COOKIE_NAMES = [
  SUPABASE_AUTH_COOKIE,
  `${SUPABASE_AUTH_COOKIE}-code-verifier`,
  ...Array.from({ length: MAX_CHUNKS }, (_, i) => `${SUPABASE_AUTH_COOKIE}.${i}`),
];

export function supabaseAuthConfig(): { url: string; key: string } | null {
  const url = import.meta.env.PUBLIC_SUPABASE_URL ?? import.meta.env.SUPABASE_URL;
  const key = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

/**
 * A fresh client for this request (never cache one across requests — it holds
 * the caller's session). Null when the publishable key isn't configured, which
 * callers treat as "no Supabase session" so the Momence fallback still works.
 */
export function createSupabaseServerClient(cookies: AstroCookies): SupabaseClient | null {
  const config = supabaseAuthConfig();
  if (!config) return null;

  return createServerClient(config.url, config.key, {
    cookieOptions: {
      name: SUPABASE_AUTH_COOKIE,
      path: '/',
      sameSite: 'lax',
      secure: import.meta.env.PROD,
    },
    cookies: {
      getAll() {
        return COOKIE_NAMES.flatMap((name) => {
          const value = cookies.get(name)?.value;
          return value === undefined ? [] : [{ name, value }];
        });
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookies.set(name, value, {
            ...options,
            // @supabase/ssr types sameSite as boolean | string; Astro wants the union.
            sameSite: options.sameSite as 'lax' | 'strict' | 'none' | boolean | undefined,
          });
        }
      },
    },
  });
}
