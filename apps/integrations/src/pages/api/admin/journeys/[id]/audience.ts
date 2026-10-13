// "Who would this enroll?" — for an audience (sweep) journey, scans the first
// few pages of matching Momence members and counts who passes the journey's
// filters and enroll conditions. An estimate for the dashboard, not a full
// scan; booking and manual journeys only enroll going forward.

import type { APIRoute } from 'astro';
import type { AudienceResponse } from '@/lib/email/journeys/api-types';
import { previewAudience } from '@/lib/email/journeys/engine';
import { definitionSchema } from '@/lib/email/journeys/schema';
import { getJourneyRow, toRecord } from '@/lib/email/journeys/store';
import { gateMutation, json, readJsonBody } from '@/lib/http/route';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, params, request }) => {
  const gate = await gateMutation(cookies, request, '/admin/journeys');
  if (gate instanceof Response) return gate;
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const row = await getJourneyRow(params.id ?? '');
  if (!row) return json({ error: 'Journey not found' }, 404);
  const record = toRecord(row).record;
  if (!record) return json({ error: 'This journey has an invalid definition' }, 409);

  // Preview the unsaved draft when one is sent.
  if (body.definition !== undefined) {
    const parsed = definitionSchema.safeParse(body.definition);
    if (!parsed.success) return json({ error: 'The draft is not valid yet' }, 400);
    record.definition = parsed.data;
  }

  const trigger = record.definition.trigger.type;
  if (trigger !== 'sweep') {
    const response: AudienceResponse = {
      kind: trigger === 'session-booked' ? 'event' : 'manual',
      scanned: 0,
      matched: 0,
      totalCandidates: 0,
      sample: [],
      partial: false,
    };
    return json(response);
  }

  try {
    const result = await previewAudience(record);
    const response: AudienceResponse = { kind: 'sweep', ...result };
    return json(response);
  } catch (e) {
    return json(
      { error: `Momence lookup failed: ${e instanceof Error ? e.message : String(e)}` },
      502
    );
  }
};
