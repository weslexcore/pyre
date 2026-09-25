// Email-first sign-in, step 1. Staff who already have a Supabase password go
// to the password step; everyone else goes through Momence (during the
// cutover) to prove who they are and set one — or, once the cutover is over,
// gets an emailed set-password link.
//
// "Not linked" and "not staff" take the same path, so this page never says
// who is on the staff list; it only reveals that an email has a password.

import type { APIRoute } from 'astro';
import { assertSameOrigin } from '@/lib/auth/admin';
import { hasLinkedAccount, normalizeEmail, sendPasswordLink } from '@/lib/auth/provision';
import { safeReturnUrl, withReturnUrl } from '@/lib/auth/return-url';
import { momenceLoginEnabled } from '@/lib/auth/session';
import { clientIp, isRateLimited } from '@/lib/boards/form-guard';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request, redirect, url, clientAddress }) => {
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const form = await request.formData();
  const returnUrl = safeReturnUrl(String(form.get('returnUrl') ?? ''));
  const email = normalizeEmail(form.get('email'));

  if (!EMAIL_RE.test(email)) {
    return redirect(withReturnUrl('/', returnUrl, { error: 'invalid_email' }), 303);
  }

  const ip = clientIp(request, () => clientAddress);
  if (await isRateLimited(`auth:rl:identify:${ip}`, 20, 600)) {
    return redirect(withReturnUrl('/', returnUrl, { error: 'rate_limited' }), 303);
  }

  if (await hasLinkedAccount(email)) {
    return redirect(withReturnUrl('/', returnUrl, { step: 'password', email }), 303);
  }

  if (momenceLoginEnabled()) {
    return redirect(withReturnUrl('/api/auth/login', returnUrl, { email }), 303);
  }

  // After the cutover: a link for staff, silence for everyone else — the
  // page reads the same either way.
  await sendPasswordLink(email, url.origin);
  return redirect(withReturnUrl('/', returnUrl, { step: 'sent', email }), 303);
};
