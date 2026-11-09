// Passkey sign-in, step one: ask Supabase for a challenge and hand the
// browser the WebAuthn request options. No email: passkeys are discoverable,
// so the browser offers whichever ones it holds for this site. The browser
// runs navigator.credentials.get() and posts the result to ./verify, which
// is where the session is made. Where to land afterwards waits in the same
// short-lived cookie the email sign-in uses.

import type { APIRoute } from 'astro';
import { assertSameOrigin } from '@/lib/auth/admin';
import { rememberReturnUrl, safeReturnUrl } from '@/lib/auth/login';
import { passkeyErrorMessage, passkeysAvailable } from '@/lib/auth/methods';
import { json, readJsonBody } from '@/lib/http/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, url }) => {
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  if (!passkeysAvailable(url)) return json({ error: 'Passkeys do not work on this address.' }, 400);

  const supabase = createSupabaseServerClient(cookies);
  if (!supabase) return json({ error: 'Sign-in is not configured' }, 503);

  const { data, error } = await supabase.auth.passkey.startAuthentication();
  if (error || !data) {
    console.error('[Auth] passkey startAuthentication failed:', error?.message);
    return json({ error: passkeyErrorMessage(error) }, 502);
  }

  rememberReturnUrl(cookies, safeReturnUrl(body.returnUrl));
  return json({ challengeId: data.challenge_id, options: data.options });
};
