// Add a passkey, step one: a registration challenge for the signed-in
// person. The browser runs navigator.credentials.create() and posts the
// result to ./verify.

import type { APIRoute } from 'astro';
import { requireStaff } from '@/lib/auth/admin';
import { passkeyErrorMessage, passkeysAvailable } from '@/lib/auth/methods';
import { beginMutation, json } from '@/lib/http/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, url }) => {
  const ready = await beginMutation(cookies, request, requireStaff);
  if (ready instanceof Response) return ready;

  if (!passkeysAvailable(url)) return json({ error: 'Passkeys do not work on this address.' }, 400);

  const supabase = createSupabaseServerClient(cookies);
  if (!supabase) return json({ error: 'Sign-in is not configured' }, 503);

  const { data, error } = await supabase.auth.passkey.startRegistration();
  if (error || !data) {
    console.error('[Auth] passkey startRegistration failed:', error?.message);
    return json({ error: passkeyErrorMessage(error) }, 502);
  }
  return json({ challengeId: data.challenge_id, options: data.options });
};
