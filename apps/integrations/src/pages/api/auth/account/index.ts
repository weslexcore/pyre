// The signed-in person's sign-in methods, for /admin/account and the
// dashboard's setup banner: whether they have a password, and their passkeys.

import type { APIRoute } from 'astro';
import { requireStaff } from '@/lib/auth/admin';
import { getSignInMethods, passkeysAvailable } from '@/lib/auth/methods';
import { getDb } from '@/lib/db';
import { json } from '@/lib/http/route';

export const prerender = false;

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requireStaff(cookies);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const methods = await getSignInMethods(db, gate.user.id);
  return json({ email: gate.user.email, ...methods, passkeysAvailable: passkeysAvailable(url) });
};
