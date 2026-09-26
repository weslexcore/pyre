// Admin gate check: 200 for allowlisted admins, 401/403 otherwise.

import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/auth/admin';
import { json } from '@/lib/http/route';

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  return json({ ok: true, email: gate.user.email });
};
