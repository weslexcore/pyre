// Save the order of /admin/journeys after a drag: POST { ids } with every
// journey id in its new position. One shared order for everyone.

import type { APIRoute } from 'astro';
import { saveJourneyOrder } from '@/lib/email/journeys/store';
import { beginMutation, json } from '@/lib/http/route';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, '/admin/journeys');
  if (ready instanceof Response) return ready;
  const { ids } = ready.body as { ids?: unknown };
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string') || ids.length > 500) {
    return json({ error: 'ids must be a list of journey ids' }, 400);
  }
  const { error } = await saveJourneyOrder(ids as string[]);
  if (error) return json({ error }, 503);
  return json({ ok: true });
};
