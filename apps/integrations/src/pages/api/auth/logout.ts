// Logout: clear the session cookies (local logout only — Momence session
// stays; matches the landing-page admin's default).

import type { APIRoute } from 'astro';
import { clearAuthCookies } from '@/lib/auth/cookies';

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  clearAuthCookies(cookies);
  return redirect(url.searchParams.get('returnUrl') || '/admin', 302);
};
