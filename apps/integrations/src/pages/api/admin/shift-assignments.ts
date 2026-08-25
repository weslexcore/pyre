// Assignment mutations for /admin/schedule: put a person on a shift (times
// default to the shift window), adjust their times/role, or take them off.
// Admin-only, CSRF-guarded in-route. Availability is advisory — the UI warns
// about time-off overlaps but the API doesn't block them (the admin may have
// confirmed with the person, as the sheet's notes show).

import type { AssignmentRole } from '@pyre/schedule-core';
import type { APIRoute } from 'astro';
import { type AdminGate, assertSameOrigin, requireScheduleManage } from '@/lib/auth/admin';
import { getDb, type ShiftAssignmentRow } from '@/lib/db';
import {
  actorFromGate,
  changedFields,
  describeShift,
  logScheduleChange,
  staffNameOf,
  summarizeDiff,
  timeWindow,
} from '@/lib/schedule/change-log';
import { acceptDraftRow } from '@/lib/schedule/draft-accept';
import { parseAssignmentFields } from '@/lib/schedule/validate';

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

/** "'Morning' on 2026-08-14", looked up for log summaries; tolerant of a
 * just-deleted or missing shift so logging can't fail the mutation. */
async function shiftDescription(
  db: NonNullable<ReturnType<typeof getDb>>,
  shiftId: string
): Promise<string> {
  const { data } = await db
    .from('shifts')
    .select('label, shift_date')
    .eq('id', shiftId)
    .maybeSingle();
  return data ? describeShift(data as { label: string; shift_date: string }) : 'a shift';
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

  const shiftId = body.shiftId;
  const staffId = body.staffId;
  if (typeof shiftId !== 'string' || !shiftId || typeof staffId !== 'string' || !staffId) {
    return json({ error: 'shiftId and staffId are required' }, 400);
  }

  const fields = parseAssignmentFields(body);
  if (typeof fields === 'string') return json({ error: fields }, 400);

  const { data: shift, error: shiftError } = await db
    .from('shifts')
    .select('id, shift_date, label, starts_at, ends_at, status')
    .eq('id', shiftId)
    .maybeSingle();
  if (shiftError) return json({ error: shiftError.message }, 500);
  if (!shift) return json({ error: 'Shift not found' }, 404);
  if (shift.status !== 'active') return json({ error: 'Shift is cancelled' }, 400);

  const startsAt = (fields.starts_at as string) ?? shift.starts_at;
  const endsAt = (fields.ends_at as string) ?? shift.ends_at;
  if (endsAt.slice(0, 5) <= startsAt.slice(0, 5)) {
    return json({ error: 'endsAt must be after startsAt' }, 400);
  }

  const { data, error } = await db
    .from('shift_assignments')
    .insert({
      shift_id: shiftId,
      staff_id: staffId,
      starts_at: startsAt,
      ends_at: endsAt,
      role: (fields.role as AssignmentRole) ?? 'full',
      notes: (fields.notes as string | null) ?? null,
    })
    .select('*')
    .single();
  if (error) {
    // 23505 = unique_violation on (shift_id, staff_id)
    if (error.code === '23505') return json({ error: 'Already assigned to this shift' }, 409);
    return json({ error: error.message }, 500);
  }

  const assignment = data as ShiftAssignmentRow;
  await logScheduleChange(db, {
    actor: actorFromGate(gate),
    entityType: 'assignment',
    entityId: assignment.id,
    action: 'create',
    summary: `Assigned ${await staffNameOf(db, staffId)} to ${describeShift(shift)} (${timeWindow(assignment)})`,
    details: { after: assignment },
  });

  return json({ assignment }, 201);
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

  const fields = parseAssignmentFields(body);
  if (typeof fields === 'string') return json({ error: fields }, 400);
  if (Object.keys(fields).length === 0) return json({ error: 'No fields to update' }, 400);

  const { data: existing, error: fetchError } = await db
    .from('shift_assignments')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) return json({ error: fetchError.message }, 500);
  if (!existing) return json({ error: 'Assignment not found' }, 404);

  const startsAt = (fields.starts_at as string) ?? existing.starts_at;
  const endsAt = (fields.ends_at as string) ?? existing.ends_at;
  if (endsAt.slice(0, 5) <= startsAt.slice(0, 5)) {
    return json({ error: 'endsAt must be after startsAt' }, 400);
  }

  const { data, error } = await db
    .from('shift_assignments')
    .update(fields)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  let assignment = data as ShiftAssignmentRow;
  const actor = actorFromGate(gate);
  const diff = changedFields(existing as Record<string, unknown>, fields);
  if (diff) {
    await logScheduleChange(db, {
      actor,
      entityType: 'assignment',
      entityId: assignment.id,
      action: 'update',
      summary: `Updated ${await staffNameOf(db, assignment.staff_id)}'s assignment on ${await shiftDescription(db, assignment.shift_id)}: ${summarizeDiff(diff)}`,
      details: diff,
    });
  }

  // Editing an AI draft accepts it — the admin adjusted the recommendation,
  // so their version goes live (parent shift included) rather than staying a
  // proposal they'd still have to ✓ separately.
  if (existing.is_draft) {
    const acceptError = await acceptDraftRow(db, {
      kind: 'assignment',
      id: assignment.id,
      shiftId: assignment.shift_id,
      proposalId: assignment.proposal_id,
    });
    if (acceptError) return json({ error: acceptError }, 500);
    assignment = { ...assignment, is_draft: false };
    await logScheduleChange(db, {
      actor,
      entityType: 'assignment',
      entityId: assignment.id,
      action: 'accept_item',
      summary: `Accepted draft assignment for ${await staffNameOf(db, assignment.staff_id)} on ${await shiftDescription(db, assignment.shift_id)} (edited)`,
      details: { proposalId: assignment.proposal_id },
    });
  }

  return json({ assignment });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await gateMutation(cookies, request);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  // Two modes: ?id= removes one assignment; ?shiftId= clears the whole
  // shift's live crew (the board's Clear button) so it can be rebuilt from
  // scratch. Draft assignments stay — the proposal review flow owns those.
  const id = url.searchParams.get('id');
  const shiftId = url.searchParams.get('shiftId');
  if (!id && !shiftId) return json({ error: 'id or shiftId is required' }, 400);

  if (shiftId) {
    const { data: rows, error: fetchError } = await db
      .from('shift_assignments')
      .select('*')
      .eq('shift_id', shiftId)
      .eq('is_draft', false);
    if (fetchError) return json({ error: fetchError.message }, 500);
    const assignments = (rows ?? []) as ShiftAssignmentRow[];
    if (assignments.length === 0) return json({ ok: true, cleared: 0 });

    const { error } = await db
      .from('shift_assignments')
      .delete()
      .eq('shift_id', shiftId)
      .eq('is_draft', false);
    if (error) return json({ error: error.message }, 500);

    const shiftDesc = await shiftDescription(db, shiftId);
    const actor = actorFromGate(gate);
    for (const assignment of assignments) {
      await logScheduleChange(db, {
        actor,
        entityType: 'assignment',
        entityId: assignment.id,
        action: 'delete',
        summary: `Removed ${await staffNameOf(db, assignment.staff_id)} from ${shiftDesc} (cleared shift)`,
        details: { before: assignment },
      });
    }

    return json({ ok: true, cleared: assignments.length });
  }

  // Snapshot before the delete so the change log can describe the row.
  const { data: existing, error: fetchError } = await db
    .from('shift_assignments')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) return json({ error: fetchError.message }, 500);
  if (!existing) return json({ error: 'Assignment not found' }, 404);

  const { error, count } = await db
    .from('shift_assignments')
    .delete({ count: 'exact' })
    .eq('id', id);
  if (error) return json({ error: error.message }, 500);
  if (!count) return json({ error: 'Assignment not found' }, 404);

  const assignment = existing as ShiftAssignmentRow;
  await logScheduleChange(db, {
    actor: actorFromGate(gate),
    entityType: 'assignment',
    entityId: assignment.id,
    action: 'delete',
    summary: `Removed ${await staffNameOf(db, assignment.staff_id)} from ${await shiftDescription(db, assignment.shift_id)}`,
    details: { before: assignment },
  });

  return json({ ok: true });
};
