// Admin gate check: 200 for allowlisted admins, 401/403 otherwise.

import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/auth/admin';

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  return new Response(JSON.stringify({ ok: true, email: gate.user.email }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
