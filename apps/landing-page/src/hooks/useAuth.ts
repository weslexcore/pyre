// React hook for authentication state
// Provides login/logout actions and user data

import { useCallback, useEffect, useState } from 'react';
import type { AuthSession, MomenceUserProfile } from '@/lib/momence-oauth-types';

interface UseAuthResult {
  isAuthenticated: boolean;
  user: MomenceUserProfile | null;
  loading: boolean;
  error: string | null;
  login: (options?: { signup?: boolean; returnUrl?: string }) => void;
  logout: (options?: { momenceLogout?: boolean; returnUrl?: string }) => void;
  refresh: () => Promise<void>;
}

// Cache key for session storage
const SESSION_CACHE_KEY = 'pyre-auth-session';
const SESSION_CACHE_TTL_MS = 60 * 1000; // 1 minute

interface CachedSession {
  session: AuthSession;
  timestamp: number;
}

function getCachedSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;

  try {
    const cached = sessionStorage.getItem(SESSION_CACHE_KEY);
    if (!cached) return null;

    const entry: CachedSession = JSON.parse(cached);
    const age = Date.now() - entry.timestamp;

    if (age < SESSION_CACHE_TTL_MS) {
      return entry.session;
    }

    // Cache expired
    sessionStorage.removeItem(SESSION_CACHE_KEY);
    return null;
  } catch {
    return null;
  }
}

function setCachedSession(session: AuthSession): void {
  if (typeof window === 'undefined') return;

  try {
    const entry: CachedSession = {
      session,
      timestamp: Date.now(),
    };
    sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Ignore storage errors
  }
}

function clearCachedSession(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(SESSION_CACHE_KEY);
}

interface UseAuthOptions {
  skipCache?: boolean;
}

export function useAuth(options?: UseAuthOptions): UseAuthResult {
  const [session, setSession] = useState<AuthSession>({
    isAuthenticated: false,
    user: null,
    expiresAt: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch session from API
  const fetchSession = useCallback(async (skipCache = false) => {
    // Check cache first (unless skip requested)
    if (!skipCache) {
      const cached = getCachedSession();
      if (cached) {
        setSession(cached);
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/session');
      const data: AuthSession = await response.json();

      setCachedSession(data);
      setSession(data);
    } catch (err) {
      console.error('[useAuth] Failed to fetch session:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch session');
      setSession({
        isAuthenticated: false,
        user: null,
        expiresAt: null,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial session fetch
  useEffect(() => {
    // If skipCache is set (fresh auth), clear cache before fetching
    if (options?.skipCache) {
      clearCachedSession();
    }
    fetchSession(options?.skipCache);
  }, [fetchSession, options?.skipCache]);

  // Login action - redirect to OAuth login
  const login = useCallback(
    (options?: { signup?: boolean; returnUrl?: string }) => {
      const params = new URLSearchParams();
      if (options?.signup) {
        params.set('signup', 'true');
      }
      if (options?.returnUrl) {
        params.set('returnUrl', options.returnUrl);
      }
      const queryString = params.toString();
      window.location.href = `/api/auth/login${queryString ? `?${queryString}` : ''}`;
    },
    []
  );

  // Logout action
  const logout = useCallback(
    (options?: { momenceLogout?: boolean; returnUrl?: string }) => {
      clearCachedSession();
      const params = new URLSearchParams();
      if (options?.momenceLogout) {
        params.set('momence', 'true');
      }
      if (options?.returnUrl) {
        params.set('returnUrl', options.returnUrl);
      }
      const queryString = params.toString();
      window.location.href = `/api/auth/logout${queryString ? `?${queryString}` : ''}`;
    },
    []
  );

  // Refresh session (skip cache)
  const refresh = useCallback(async () => {
    clearCachedSession();
    await fetchSession(true);
  }, [fetchSession]);

  return {
    isAuthenticated: session.isAuthenticated,
    user: session.user,
    loading,
    error,
    login,
    logout,
    refresh,
  };
}
