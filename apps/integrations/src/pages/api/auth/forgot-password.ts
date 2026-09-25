// "Forgot password": emails a one-time set-password link to staff. The answer
// is the same whether or not the email has access, so the form can't be used
// to probe the staff list.

import type { APIRoute } from 'astro';
import { assertSameOrigin } from '@/lib/auth/admin';
import { normalizeEmail, sendPasswordLink } from '@/lib/auth/provision';
import { safeReturnUrl, withReturnUrl } from '@/lib/auth/return-url';
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
    return redirect(withReturnUrl('/forgot-password', returnUrl, { error: 'invalid_email' }), 303);
  }

  // Each request sends mail, so the budget is tighter than sign-in's — per
  // address and per email, so one inbox can't be flooded from many IPs.
  const ip = clientIp(request, () => clientAddress);
  const limited =
    (await isRateLimited(`auth:rl:forgot:${ip}`, 5, 600)) ||
    (await isRateLimited(`auth:rl:forgot-email:${email}`, 3, 600));
  if (!limited) await sendPasswordLink(email, url.origin);

  return redirect(withReturnUrl('/forgot-password', returnUrl, { sent: '1', email }), 303);
};
