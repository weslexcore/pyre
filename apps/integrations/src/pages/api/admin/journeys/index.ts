// Journeys (/admin/journeys): GET lists every journey with its enrollment
// counts and 30-day send numbers; POST creates one — blank, or a copy of an
// existing journey (`duplicateFrom`). New journeys start switched off and in
// test mode, linked to a campaign of the same name in the Campaigns tool
// (created if none exists) so their email links report there.

import type { APIRoute } from 'astro';
import { getEmailGate } from '@/lib/email/dev-mode';
import { journeyStats } from '@/lib/email/journeys/admin';
import { toSummary } from '@/lib/email/journeys/admin-dto';
import type { JourneyListResponse } from '@/lib/email/journeys/api-types';
import { ensureJourneyCampaign } from '@/lib/email/journeys/campaign';
import { createJourney, getJourneyRow, listJourneyRows } from '@/lib/email/journeys/store';
import { beginMutation, beginRead, json, storeError } from '@/lib/http/route';

export const prerender = false;

const PAGE = '/admin/journeys';

export const GET: APIRoute = async ({ cookies }) => {
  const ready = await beginRead(cookies, PAGE);
  if (ready instanceof Response) return ready;
  try {
    const [rows, stats, gate] = await Promise.all([
      listJourneyRows(),
      journeyStats(ready.db),
      getEmailGate(),
    ]);
    const body: JourneyListResponse = {
      journeys: rows.map(({ row }) => toSummary(row, stats[row.id])),
      journeyTemplateLive: gate.isLive('journey'),
    };
    return json(body);
  } catch (e) {
    return storeError('Journeys', e);
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, PAGE);
  if (ready instanceof Response) return ready;
  const { id, name, definition, duplicateFrom } = ready.body as {
    id?: unknown;
    name?: unknown;
    definition?: unknown;
    duplicateFrom?: unknown;
  };
  if (typeof id !== 'string' || typeof name !== 'string') {
    return json({ error: 'id and name are required' }, 400);
  }

  let source = definition;
  if (typeof duplicateFrom === 'string') {
    const original = await getJourneyRow(duplicateFrom);
    if (!original) return json({ error: 'The journey to copy no longer exists' }, 404);
    source = original.definition;
  }

  // Link the new journey to its campaign. A failure here doesn't block
  // creating the journey — its links fall back to the journey id, and the
  // Overview tab offers the link again.
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    const linked = await ensureJourneyCampaign({ id: id.trim(), name: name.trim() }, ready.email);
    if (linked.ok)
      source = { ...(source as Record<string, unknown>), campaign: linked.campaign.slug };
  }

  const result = await createJourney({ id: id.trim(), name, definition: source }, ready.email);
  if (!result.ok) return json({ error: result.error, issues: result.issues }, result.status);
  return json({ journey: toSummary(result.row) }, 201);
};
