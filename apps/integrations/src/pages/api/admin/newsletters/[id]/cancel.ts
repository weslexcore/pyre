// Stop a newsletter that is sending or scheduled (admins only). Copies
// already sent stay sent; one that never started goes back to being a draft.

import type { APIRoute } from 'astro';
import { cancelSend } from '@/lib/email/newsletter/admin';
import { beginMutation, isUuid, json } from '@/lib/http/route';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, params, request }) => {
  const ready = await beginMutation(cookies, request, '/admin/newsletters');
  if (ready instanceof Response) return ready;
  if (!ready.gate.access.isAdmin) return json({ error: 'Only admins can stop a newsletter' }, 403);
  if (!isUuid(params.id)) return json({ error: 'Not found' }, 404);
  const result = await cancelSend(ready.db, params.id);
  if (!result.ok) return json({ error: result.error }, result.status);
  return json({ issue: result.issue });
};
