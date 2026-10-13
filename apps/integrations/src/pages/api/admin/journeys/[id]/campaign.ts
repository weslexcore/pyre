// Link a journey to a campaign in the Campaigns tool: creates an evergreen
// campaign named after the journey — or finds the existing one by that name —
// and returns it. The editor puts its slug into the draft; saving the journey
// makes the link.

import type { APIRoute } from 'astro';
import { ensureJourneyCampaign } from '@/lib/email/journeys/campaign';
import { getJourneyRow } from '@/lib/email/journeys/store';
import { beginMutation, json } from '@/lib/http/route';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, params, request }) => {
  const ready = await beginMutation(cookies, request, '/admin/journeys');
  if (ready instanceof Response) return ready;

  const row = await getJourneyRow(params.id ?? '');
  if (!row) return json({ error: 'Journey not found' }, 404);

  const name =
    typeof ready.body.name === 'string' && ready.body.name.trim()
      ? ready.body.name.trim()
      : row.name;
  const result = await ensureJourneyCampaign({ id: row.id, name }, ready.email);
  if (!result.ok) return json({ error: result.error }, 503);
  return json({ campaign: result.campaign, created: result.created });
};
