import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getOptimizedCookieOptions } from './cookie-config';

/**
 * Especially important if using Fluid compute: Don't put this client in a
 * global variable. Always create a new client within each function when using
 * it.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            const cookieOptions = getOptimizedCookieOptions();

            cookiesToSet.forEach(({ name, value, options = {} }) => {
              const finalOptions = {
                ...cookieOptions,
                ...options,
                // Ensure httpOnly is properly set for server-side cookies
                httpOnly: options.httpOnly ?? cookieOptions.httpOnly ?? false,
              };

              cookieStore.set(name, value, finalOptions);
            });
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  );
}
