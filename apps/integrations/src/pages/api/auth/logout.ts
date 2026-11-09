// Sign out. A POST (from the small forms in the nav and the unauthorized
// screens), so a prefetch or a stray GET can never end someone's session:
// the GET below only shows the login page. Revokes this session's refresh
// token at Supabase when it can, and clears the cookies either way.

import type { APIRoute } from 'astro';
import { assertSameOrigin } from '@/lib/auth/admin';
import { endSession } from '@/lib/auth/login';
import { createSupabaseServerClient, hasSessionCookie } from '@/lib/supabase/server';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  await endSession(hasSessionCookie(cookies) ? createSupabaseServerClient(cookies) : null, cookies);

  return redirect('/', 303);
};

export const GET: APIRoute = async ({ redirect }) => redirect('/', 302);
