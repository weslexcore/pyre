// Shift CRUD for /admin/schedule (reads come from schedule-board). Admin-only
// mutations, CSRF-guarded in-route via assertSameOrigin (global checkOrigin is
// off — see astro.config.mjs). Editing a momence-sourced shift sets
// sync_locked so the Phase-3 sync won't overwrite the admin's adjustment.

import type { APIRoute } from 'astro';
import { type AdminGate, assertSameOrigin, requireScheduleManage } from '@/lib/auth/admin';
import { getDb, type ShiftRow } from '@/lib/db';
import {
  actorFromGate,
  changedFields,
  describeShift,
  logScheduleChange,
  summarizeDiff,
  timeWindow,
} from '@/lib/schedule/change-log';
import { acceptDraftRow } from '@/lib/schedule/draft-accept';
import { parseShiftFields } from '@/lib/schedule/validate';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function gateMutation(
  cookies: Parameters<APIRoute>[0]['cookies'],
  request: Request
): Promise<AdminGate | Response> {
  const gate = await requireScheduleManage(cookies);
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  return gate;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | Response> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await gateMutation(cookies, request);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const fields = parseShiftFields(body);
  if (typeof fields === 'string') return json({ error: fields }, 400);
  for (const required of ['shift_date', 'label', 'starts_at', 'ends_at'] as const) {
    if (fields[required] === undefined) {
      return json({ error: 'shiftDate, label, startsAt, and endsAt are required' }, 400);
    }
  }

  const { data, error } = await db
    .from('shifts')
    .insert({ ...fields, source: 'manual' })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  const shift = data as ShiftRow;
  await logScheduleChange(db, {
    actor: actorFromGate(gate),
    entityType: 'shift',
    entityId: shift.id,
    action: 'create',
    summary: `Created shift ${describeShift(shift)} (${timeWindow(shift)})`,
    details: { after: shift },
  });

  return json({ shift }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const gate = await gateMutation(cookies, request);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const id = body.id;
  if (typeof id !== 'string' || !id) return json({ error: 'id is required' }, 400);

  const fields = parseShiftFields(body);
  if (typeof fields === 'string') return json({ error: fields }, 400);
  if (Object.keys(fields).length === 0) return json({ error: 'No fields to update' }, 400);

  const { data: existing, error: fetchError } = await db
    .from('shifts')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) return json({ error: fetchError.message }, 500);
  if (!existing) return json({ error: 'Shift not found' }, 404);

  // Cross-field time check when only one side changes.
  const starts = (fields.starts_at as string) ?? existing.starts_at;
  const ends = (fields.ends_at as string) ?? existing.ends_at;
  if (ends.slice(0, 5) <= starts.slice(0, 5))
    return json({ error: 'endsAt must be after startsAt' }, 400);

  // Editing a Momence shift takes ownership of it: lock it against the sync
  // and treat any divergence flag as resolved by the admin's adjustment.
  if (existing.source === 'momence') {
    fields.sync_locked = true;
    fields.sync_flag = null;
  }

  const { data, error } = await db.from('shifts').update(fields).eq('id', id).select('*').single();
  if (error) return json({ error: error.message }, 500);

  let shift = data as ShiftRow;
  const actor = actorFromGate(gate);
  const diff = changedFields(existing as Record<string, unknown>, fields);
  if (diff) {
    await logScheduleChange(db, {
      actor,
      entityType: 'shift',
      entityId: shift.id,
      action: 'update',
      summary: `Updated shift ${describeShift(shift)}: ${summarizeDiff(diff)}`,
      details: diff,
    });
  }

  // Editing an AI draft accepts it — the admin's adjusted version goes live
  // instead of staying a proposal they'd still have to ✓ separately.
  if (existing.is_draft) {
    const acceptError = await acceptDraftRow(db, {
      kind: 'shift',
      id: shift.id,
      proposalId: shift.proposal_id,
    });
    if (acceptError) return json({ error: acceptError }, 500);
    shift = { ...shift, is_draft: false };
    await logScheduleChange(db, {
      actor,
      entityType: 'shift',
      entityId: shift.id,
      action: 'accept_item',
      summary: `Accepted draft shift ${describeShift(shift)} (edited)`,
      details: { proposalId: shift.proposal_id },
    });
  }

  return json({ shift });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await gateMutation(cookies, request);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400);

  // Snapshot before the hard delete so the change log can describe the row.
  const { data: existing, error: fetchError } = await db
    .from('shifts')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) return json({ error: fetchError.message }, 500);
  if (!existing) return json({ error: 'Shift not found' }, 404);

  // Hard delete (assignments cascade) — for mistakes. Cancelling a real shift
  // that people were scheduled for should PATCH status instead, so the record
  // survives.
  const { error, count } = await db.from('shifts').delete({ count: 'exact' }).eq('id', id);
  if (error) return json({ error: error.message }, 500);
  if (!count) return json({ error: 'Shift not found' }, 404);

  const shift = existing as ShiftRow;
  await logScheduleChange(db, {
    actor: actorFromGate(gate),
    entityType: 'shift',
    entityId: shift.id,
    action: 'delete',
    summary: `Deleted shift ${describeShift(shift)} (${timeWindow(shift)})`,
    details: { before: shift },
  });

  return json({ ok: true });
};
