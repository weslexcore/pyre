// Rename (PATCH { id, name }) or remove (DELETE ?id=) one of the signed-in
// person's passkeys. Supabase scopes both to the session's own user, so
// nobody can touch someone else's.

import type { APIRoute } from 'astro';
import { requireStaff } from '@/lib/auth/admin';
import { beginDelete, beginMutation, isUuid, json } from '@/lib/http/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const prerender = false;

const MAX_NAME = 120;

export const PATCH: APIRoute = async ({ request, cookies }) => {
  const ready = await beginMutation(cookies, request, requireStaff);
  if (ready instanceof Response) return ready;

  const id = typeof ready.body.id === 'string' ? ready.body.id : '';
  const name = typeof ready.body.name === 'string' ? ready.body.name.trim() : '';
  if (!isUuid(id)) return json({ error: 'Unknown passkey' }, 400);
  if (!name || name.length > MAX_NAME) {
    return json({ error: `Give it a name up to ${MAX_NAME} characters.` }, 400);
  }

  const supabase = createSupabaseServerClient(cookies);
  if (!supabase) return json({ error: 'Sign-in is not configured' }, 503);

  const { data, error } = await supabase.auth.passkey.update({ passkeyId: id, friendlyName: name });
  if (error) {
    console.warn('[Auth] passkey update failed:', error.message);
    return json({ error: 'Could not rename the passkey.' }, 502);
  }
  return json({ passkey: data });
};

export const DELETE: APIRoute = async ({ request, cookies, url }) => {
  const ready = await beginDelete(cookies, request, requireStaff);
  if (ready instanceof Response) return ready;

  const id = url.searchParams.get('id') ?? '';
  if (!isUuid(id)) return json({ error: 'Unknown passkey' }, 400);

  const supabase = createSupabaseServerClient(cookies);
  if (!supabase) return json({ error: 'Sign-in is not configured' }, 503);

  const { error } = await supabase.auth.passkey.delete({ passkeyId: id });
  if (error) {
    console.warn('[Auth] passkey delete failed:', error.message);
    return json({ error: 'Could not remove the passkey.' }, 502);
  }
  return json({ ok: true });
};
