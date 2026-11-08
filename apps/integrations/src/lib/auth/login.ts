// What the sign-in routes share (api/auth/login, verify, callback) and the
// login page reads: where to send someone after they sign in, how to tell a
// stranger's email from a real failure, and the first-sign-in bookkeeping.
//
// The flow: the login page POSTs an email; the server asks Supabase for a
// magic link (sign-up closed, so only an existing auth user gets one); the
// email carries both a link back to /api/auth/callback and a 6-digit code.
// Either is verified on the server, which sets the session cookies.

import type { User } from '@supabase/supabase-js';
import type { AstroCookies } from 'astro';
import { getDb } from '@/lib/db';
import { linkStaffUser } from './users';

export const DEFAULT_RETURN_URL = '/admin';
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Only ever bounce back to local admin paths, or a board's form — the one
// page outside /admin that asks a visitor to sign in (avoids open redirects).
const RETURN_URL_RE = /^\/(admin|forms)(\/|\?|$)/;

// Where to land after the link is clicked. A cookie, not a query parameter
// on the link: the link's destination is fixed by the email template, and
// the callback has no other memory of where the person started.
const RETURN_URL_COOKIE = 'pyre_return_url';
const RETURN_URL_MAX_AGE = 60 * 10;

export function safeReturnUrl(raw: unknown): string {
  return typeof raw === 'string' && RETURN_URL_RE.test(raw) ? raw : DEFAULT_RETURN_URL;
}

export function rememberReturnUrl(cookies: AstroCookies, returnUrl: string): void {
  cookies.set(RETURN_URL_COOKIE, safeReturnUrl(returnUrl), {
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    path: '/',
    maxAge: RETURN_URL_MAX_AGE,
  });
}

/** Read and clear the remembered destination; /admin when there is none (a link opened on another device). */
export function takeReturnUrl(cookies: AstroCookies): string {
  const value = cookies.get(RETURN_URL_COOKIE)?.value;
  cookies.delete(RETURN_URL_COOKIE, { path: '/' });
  return safeReturnUrl(value);
}

/** The login page URL carrying an error code and the destination to retry for. */
export function loginRedirect(returnUrl: string, error?: string): string {
  const params = new URLSearchParams({ returnUrl });
  if (error) params.set('error', error);
  return `/?${params.toString()}`;
}

/**
 * After a successful verify: point the staff row with this email at the
 * auth user (a no-op once linked). Access checks fall back to the email, so
 * a failure here changes nothing about what the person can open.
 */
export async function afterSignIn(user: User): Promise<void> {
  const db = getDb();
  if (!db || !user.email) return;
  await linkStaffUser(db, user.id, user.email);
}
