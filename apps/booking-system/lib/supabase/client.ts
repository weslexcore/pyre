import { createBrowserClient } from '@supabase/ssr';
import {
  getOptimizedCookieOptions,
  getSafariOptimizedCookieOptions,
  getSessionPersistenceConfig,
  isSafari,
  isWebKit,
} from './cookie-config';

export function createClient() {
  const sessionConfig = getSessionPersistenceConfig();
  const isAppleBrowser = isSafari() || isWebKit();

  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        autoRefreshToken: sessionConfig.autoRefreshToken,
        persistSession: sessionConfig.persistSession,
        detectSessionInUrl: sessionConfig.detectSessionInUrl,
        flowType: 'pkce', // More secure than implicit flow
        // Enable refresh token rotation for better security
        ...(sessionConfig.enableRefreshTokenRotation && {
          storage: {
            getItem: (key) => {
              if (typeof window === 'undefined') return null;
              return localStorage.getItem(key);
            },
            setItem: (key, value) => {
              if (typeof window === 'undefined') return;
              localStorage.setItem(key, value);
            },
            removeItem: (key) => {
              if (typeof window === 'undefined') return;
              localStorage.removeItem(key);
            },
          },
        }),
      },
      cookies: {
        getAll() {
          if (typeof document === 'undefined') return [];
          return document.cookie
            .split(';')
            .map((cookie) => cookie.trim().split('='))
            .filter(([name]) => name)
            .map(([name, value]) => ({ name, value: decodeURIComponent(value || '') }));
        },
        setAll(cookiesToSet) {
          if (typeof document === 'undefined') return;

          const cookieOptions = isAppleBrowser
            ? getSafariOptimizedCookieOptions()
            : getOptimizedCookieOptions();

          cookiesToSet.forEach(({ name, value, options = {} }) => {
            const finalOptions = { ...cookieOptions, ...options };

            // Prefer Cookie Store API when available
            const hasCookieStore = typeof window !== 'undefined' && 'cookieStore' in window;
            if (hasCookieStore) {
              const expires = finalOptions.maxAge
                ? Date.now() + finalOptions.maxAge * 1000
                : undefined;
              const sameSite =
                finalOptions.sameSite === true
                  ? 'strict'
                  : finalOptions.sameSite
                  ? (finalOptions.sameSite.toLowerCase() as 'lax' | 'strict' | 'none')
                  : undefined;
              window.cookieStore.set({
                name,
                value: encodeURIComponent(value),
                domain: finalOptions.domain,
                path: finalOptions.path,
                sameSite,
                expires,
              });
            } else {
              let cookieString = `${name}=${encodeURIComponent(value)}`;

              if (finalOptions.domain) {
                cookieString += `; Domain=${finalOptions.domain}`;
              }

              if (finalOptions.path) {
                cookieString += `; Path=${finalOptions.path}`;
              }

              if (finalOptions.maxAge) {
                cookieString += `; Max-Age=${finalOptions.maxAge}`;
              }

              if (finalOptions.secure) {
                cookieString += '; Secure';
              }

              // Do not attempt to set HttpOnly from client; browsers ignore this flag in document.cookie

              if (finalOptions.sameSite) {
                cookieString += `; SameSite=${finalOptions.sameSite}`;
              }

              // biome-ignore lint/suspicious/noDocumentCookie: Fallback when Cookie Store API unavailable
              document.cookie = cookieString;
            }
          });
        },
      },
    }
  );
}
