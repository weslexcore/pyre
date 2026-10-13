// One journey: GET returns it with its revision history and a check of the
// Momence tags it names; PUT saves a new definition (compare-and-swap on
// `baseRevision`, re-timing anyone waiting on a step whose timing changed);
// PATCH flips enabled / test mode / archived.

import type { APIRoute } from 'astro';
import { getEmailGate } from '@/lib/email/dev-mode';
import { allTagNames, journeyStats, missingTags, tagsIn } from '@/lib/email/journeys/admin';
import { toSummary } from '@/lib/email/journeys/admin-dto';
import type { JourneyDetailResponse } from '@/lib/email/journeys/api-types';
import { rescheduleWaiting, resumeHeldEnrollments } from '@/lib/email/journeys/engine';
import {
  getJourneyRow,
  listRevisions,
  saveJourney,
  setJourneyFlags,
  toRecord,
} from '@/lib/email/journeys/store';
import { beginMutation, beginRead, json, sessionEmail, storeError } from '@/lib/http/route';

export const prerender = false;

const PAGE = '/admin/journeys';

export const GET: APIRoute = async ({ cookies, params }) => {
  const ready = await beginRead(cookies, PAGE);
  if (ready instanceof Response) return ready;
  try {
    const row = await getJourneyRow(params.id ?? '');
    if (!row) return json({ error: 'Journey not found' }, 404);
    const record = toRecord(row).record;
    const [revisions, stats, tags, missing, gate] = await Promise.all([
      listRevisions(row.id),
      journeyStats(ready.db),
      allTagNames(),
      record ? missingTags(tagsIn(record.definition)) : Promise.resolve([]),
      getEmailGate(),
    ]);
    const body: JourneyDetailResponse = {
      journey: toSummary(row, stats[row.id]),
      revisions: revisions.map((r) => ({
        revision: r.revision,
        name: r.name,
        definition: r.definition,
        editedBy: r.edited_by,
        note: r.note,
        createdAt: r.created_at,
      })),
      tags,
      missingTags: missing,
      journeyTemplateLive: gate.isLive('journey'),
      viewerEmail: sessionEmail(ready.gate),
      whitelist: gate.whitelist.map((w) => w.email),
    };
    return json(body);
  } catch (e) {
    return storeError('Journeys', e);
  }
};

export const PUT: APIRoute = async ({ cookies, params, request }) => {
  const ready = await beginMutation(cookies, request, PAGE);
  if (ready instanceof Response) return ready;
  const { name, definition, baseRevision, note } = ready.body as {
    name?: unknown;
    definition?: unknown;
    baseRevision?: unknown;
    note?: unknown;
  };
  if (typeof baseRevision !== 'number') return json({ error: 'baseRevision is required' }, 400);

  const result = await saveJourney(
    params.id ?? '',
    {
      name: typeof name === 'string' ? name : undefined,
      definition,
      baseRevision,
      note: typeof note === 'string' ? note : undefined,
    },
    ready.email
  );
  if (!result.ok) return json({ error: result.error, issues: result.issues }, result.status);

  let rescheduled = 0;
  const record = toRecord(result.row).record;
  if (record && result.timingChanged && result.timingChanged.length > 0) {
    rescheduled = await rescheduleWaiting(record, result.timingChanged);
  }
  const missing = record ? await missingTags(tagsIn(record.definition)) : [];
  return json({ journey: toSummary(result.row), rescheduled, missingTags: missing });
};

export const PATCH: APIRoute = async ({ cookies, params, request }) => {
  const ready = await beginMutation(cookies, request, PAGE);
  if (ready instanceof Response) return ready;
  const { enabled, testMode, archived } = ready.body as {
    enabled?: unknown;
    testMode?: unknown;
    archived?: unknown;
  };
  const flags: { enabled?: boolean; testMode?: boolean; archived?: boolean } = {};
  if (typeof enabled === 'boolean') flags.enabled = enabled;
  if (typeof testMode === 'boolean') flags.testMode = testMode;
  if (typeof archived === 'boolean') flags.archived = archived;
  if (Object.keys(flags).length === 0) {
    return json({ error: 'Nothing to change (enabled, testMode or archived)' }, 400);
  }

  const result = await setJourneyFlags(params.id ?? '', flags, ready.email);
  if (!result.ok) return json({ error: result.error }, result.status);

  // Coming back on: pull forward what came due while it was paused.
  const resumed =
    flags.enabled === true && result.wasEnabled === false
      ? await resumeHeldEnrollments(result.row.id)
      : 0;
  return json({ journey: toSummary(result.row), resumed });
};
