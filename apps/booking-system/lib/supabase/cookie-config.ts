import type { CookieOptions } from '@supabase/ssr';

// Browser detection utilities
export function isSafari(): boolean {
  if (typeof window === 'undefined') return false;

  const userAgent = window.navigator.userAgent;
  return /^((?!chrome|android).)*safari/i.test(userAgent);
}

export function isWebKit(): boolean {
  if (typeof window === 'undefined') return false;

  return /webkit/i.test(window.navigator.userAgent) && !/chrome/i.test(window.navigator.userAgent);
}

export function isIOS(): boolean {
  if (typeof window === 'undefined') return false;

  return /iPad|iPhone|iPod/.test(window.navigator.userAgent);
}

export function isPrivateMode(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(false);
      return;
    }

    // Test localStorage availability (commonly restricted in private mode)
    try {
      const testKey = '__test_private_mode__';
      localStorage.setItem(testKey, 'test');
      localStorage.removeItem(testKey);
      resolve(false);
    } catch {
      resolve(true);
    }
  });
}

// Environment detection
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

// Cookie configuration for different environments and browsers
export function getOptimizedCookieOptions(): Partial<CookieOptions> {
  const baseOptions: Partial<CookieOptions> = {
    httpOnly: false, // Must be false for Supabase client-side access
    secure: isProduction(),
    sameSite: 'lax', // Better compatibility than 'strict'
    maxAge: 60 * 60 * 24 * 7, // 7 days
  };

  // Production-specific optimizations
  if (isProduction()) {
    return {
      ...baseOptions,
      secure: true,
      domain: process.env.NEXT_PUBLIC_COOKIE_DOMAIN || undefined,
      path: '/',
    };
  }

  // Development-specific settings
  return {
    ...baseOptions,
    secure: false, // Allow non-HTTPS in development
    path: '/',
    // Don't set domain in development to work with localhost
  };
}

// Safari/WebKit-specific cookie options
export function getSafariOptimizedCookieOptions(): Partial<CookieOptions> {
  const baseOptions = getOptimizedCookieOptions();

  return {
    ...baseOptions,
    sameSite: 'none', // Safari sometimes requires 'none' for cross-site
    secure: true, // Required when sameSite is 'none'
    // Shorter maxAge for Safari due to ITP (Intelligent Tracking Prevention)
    maxAge: 60 * 60 * 24 * 1, // 1 day instead of 7
  };
}

// Session persistence configuration
export interface SessionPersistenceConfig {
  enableRefreshTokenRotation: boolean;
  autoRefreshToken: boolean;
  persistSession: boolean;
  detectSessionInUrl: boolean;
}

export function getSessionPersistenceConfig(): SessionPersistenceConfig {
  return {
    enableRefreshTokenRotation: true,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  };
}

// Cookie naming strategy for better organization
export function getCookieNames() {
  const prefix = isProduction() ? 'sb' : 'sb-dev';

  return {
    accessToken: `${prefix}-access-token`,
    refreshToken: `${prefix}-refresh-token`,
    authToken: `${prefix}-auth-token`,
    pkceVerifier: `${prefix}-pkce-code-verifier`,
  };
}
