// Add a passkey, step two: Supabase checks the new credential against the
// challenge from ./options and stores it on the signed-in user.

import type { APIRoute } from 'astro';
import { requireStaff } from '@/lib/auth/admin';
import { passkeyErrorMessage } from '@/lib/auth/methods';
import { beginMutation, json } from '@/lib/http/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const prerender = false;

type Credential = Parameters<
  NonNullable<
    ReturnType<typeof createSupabaseServerClient>
  >['auth']['passkey']['verifyRegistration']
>[0]['credential'];

export const POST: APIRoute = async ({ request, cookies }) => {
  const ready = await beginMutation(cookies, request, requireStaff);
  if (ready instanceof Response) return ready;

  const challengeId = typeof ready.body.challengeId === 'string' ? ready.body.challengeId : '';
  const credential = ready.body.credential;
  if (!challengeId || !credential || typeof credential !== 'object') {
    return json({ error: 'Could not add the passkey. Try again.' }, 400);
  }

  const supabase = createSupabaseServerClient(cookies);
  if (!supabase) return json({ error: 'Sign-in is not configured' }, 503);

  const { data, error } = await supabase.auth.passkey.verifyRegistration({
    challengeId,
    credential: credential as Credential,
  });
  if (error || !data) {
    console.warn('[Auth] passkey verifyRegistration failed:', error?.message);
    return json({ error: passkeyErrorMessage(error) }, 400);
  }
  return json({ passkey: data });
};
