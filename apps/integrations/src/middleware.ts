// Admin page gate. Redirects have to happen before the page starts streaming,
// which a layout component can't do — so unauthenticated visitors to /admin/*
// pages are bounced to the login page here, and the validated user plus their
// dashboard access (dashboard_users lookup) are handed to AdminLayout via
// locals. /api/admin/* routes are NOT covered (different path prefix): each
// one re-checks the session via requireAdmin/requirePage and returns JSON
// 401/403 instead of redirecting.

import { defineMiddleware } from 'astro/middleware';
import { getAccess } from '@/lib/auth/access';
import { validateSession } from '@/lib/auth/session';

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  const isAdminPage = pathname === '/admin' || pathname.startsWith('/admin/');
  if (!isAdminPage) return next();

  const { session } = await validateSession(context.cookies);
  if (!session.isAuthenticated || !session.user) {
    // Forward any OAuth error (the auth callback redirects failures to
    // /admin?error=...) so the login screen can show it.
    const params = new URLSearchParams({ returnUrl: pathname });
    const authError = context.url.searchParams.get('error');
    if (authError) params.set('error', authError);
    return context.redirect(`/?${params.toString()}`, 302);
  }

  context.locals.adminUser = session.user;
  context.locals.adminAccess = session.user.email ? await getAccess(session.user.email) : null;
  return next();
});
