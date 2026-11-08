// Set or change the signed-in person's password. The session is the proof
// (config.toml keeps secure_password_change off), and Supabase enforces the
// minimum length. Also records has_password (lib/auth/methods.ts), since
// Supabase will not say whether a user has one.

import type { APIRoute } from 'astro';
import { requireStaff } from '@/lib/auth/admin';
import { markHasPassword } from '@/lib/auth/methods';
import { beginMutation, json } from '@/lib/http/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const prerender = false;

const MIN_LENGTH = 10;

export const POST: APIRoute = async ({ request, cookies }) => {
  const ready = await beginMutation(cookies, request, requireStaff);
  if (ready instanceof Response) return ready;

  const password = typeof ready.body.password === 'string' ? ready.body.password : '';
  if (password.length < MIN_LENGTH) {
    return json({ error: `Use at least ${MIN_LENGTH} characters.` }, 400);
  }

  const supabase = createSupabaseServerClient(cookies);
  if (!supabase) return json({ error: 'Sign-in is not configured' }, 503);

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === 'same_password') {
      return json({ error: 'That is already your password.' }, 400);
    }
    if (error.code === 'weak_password') {
      return json({ error: 'That password is too weak. Try a longer one.' }, 400);
    }
    console.error('[Auth] updateUser(password) failed:', error.message);
    return json({ error: 'Could not save your password. Try again.' }, 502);
  }

  await markHasPassword(ready.db, ready.gate.user.id);
  return json({ ok: true });
};
