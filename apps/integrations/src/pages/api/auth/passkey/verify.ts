// Passkey sign-in, step two: the browser posts what
// navigator.credentials.get() returned, Supabase checks it against the
// challenge from ./options, and the session cookies come back on this
// response. finishSignIn keeps them only for someone with dashboard access.

import type { APIRoute } from 'astro';
import { assertSameOrigin } from '@/lib/auth/admin';
import { finishSignIn, takeReturnUrl } from '@/lib/auth/login';
import { passkeyErrorMessage } from '@/lib/auth/methods';
import { json, readJsonBody } from '@/lib/http/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const prerender = false;

type Credential = Parameters<
  NonNullable<
    ReturnType<typeof createSupabaseServerClient>
  >['auth']['passkey']['verifyAuthentication']
>[0]['credential'];

export const POST: APIRoute = async ({ request, cookies }) => {
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const challengeId = typeof body.challengeId === 'string' ? body.challengeId : '';
  const credential = body.credential;
  if (!challengeId || !credential || typeof credential !== 'object') {
    return json({ error: 'Passkey sign-in failed. Try again.' }, 400);
  }

  const supabase = createSupabaseServerClient(cookies);
  if (!supabase) return json({ error: 'Sign-in is not configured' }, 503);

  const { data, error } = await supabase.auth.passkey.verifyAuthentication({
    challengeId,
    credential: credential as Credential,
  });
  if (error || !data?.user) {
    console.warn('[Auth] passkey verifyAuthentication failed:', error?.message ?? 'no user');
    return json({ error: passkeyErrorMessage(error) }, 400);
  }

  if (!(await finishSignIn(supabase, data.user, cookies))) {
    return json({ error: 'You do not have access to the admin tools.' }, 403);
  }
  return json({ redirectTo: takeReturnUrl(cookies) });
};
