// Logout endpoint
// Clears session cookies and optionally redirects to Momence logout

import type { APIRoute } from 'astro';
import { clearAuthCookies } from '@/lib/auth-cookies';
import { buildLogoutUrl } from '@/lib/momence-oauth';

export const prerender = false;

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  // Clear all auth cookies
  clearAuthCookies(cookies);

  // Get optional return URL
  const returnUrl = url.searchParams.get('returnUrl') || '/';

  // Check if we should also logout from Momence
  const momenceLogout = url.searchParams.get('momence') === 'true';

  if (momenceLogout) {
    // Redirect to Momence logout, then back to our site
    const absoluteReturnUrl = new URL(returnUrl, url.origin).toString();
    const logoutUrl = buildLogoutUrl(absoluteReturnUrl);
    return redirect(logoutUrl, 302);
  }

  // Just redirect to return URL (local logout only)
  return redirect(returnUrl, 302);
};
