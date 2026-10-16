// Off-shift duties on the schedule board: who fills the carboys this Monday.
//   POST   { dutyKey, date, staffId }  — hand that day's duty to someone,
//                                        replacing whoever had it
//   PATCH  { id, done?, notes? }       — tick it done (or undo), or note it
//   DELETE ?id=                        — take it off them; the day is open again
//
// Assigning and unassigning need schedule:manage, like shift assignments.
// Ticking done is also open to the person it's assigned to — it's their job
// to say it's done. Only an off-shift duty, on one of its days, to an active
// person trained on it (when it requires training) can be assigned. Read
// through GET /api/admin/schedule-board.

import { type DutyAssignmentRow, dutyRunsOn } from '@pyre/schedule-core';
import type { APIRoute } from 'astro';
import { hasScheduleManage } from '@/components/admin/adminTools';
import { type AdminGate, requireScheduleManage } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import { normalizeEmail } from '@/lib/email/address';
import { dbError, gateMutation, isUuid, json, readJsonBody } from '@/lib/http/route';
import { actorFromGate, logScheduleChange, staffNameOf } from '@/lib/schedule/change-log';
import { loadDutyCatalog, loadDutyTraining } from '@/lib/schedule/duties';
import { DUTY_KEY_RE } from '@/lib/schedule/duty-validate';
import { DATE_RE, trainingError } from '@/lib/schedule/validate';

export const prerender = false;

type Db = NonNullable<ReturnType<typeof getDb>>;

/** "Fill Carboys on 2026-10-19", for the change log. */
async function describe(db: Db, row: Pick<DutyAssignmentRow, 'duty_key' | 'duty_date'>) {
  const def = (await loadDutyCatalog(db)).find((d) => d.key === row.duty_key);
  return `${def?.label ?? row.duty_key} on ${row.duty_date}`;
}

/** The staff id behind the caller's login, or null. */
async function selfStaffId(db: Db, gate: AdminGate): Promise<string | null> {
  const email = normalizeEmail(gate.user.email);
  if (!email) return null;
  const { data } = await db.from('staff').select('id, email').not('email', 'is', null);
  const rows = (data ?? []) as Array<{ id: string; email: string }>;
  return rows.find((s) => s.email.toLowerCase() === email)?.id ?? null;
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await gateMutation(cookies, request, requireScheduleManage);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const dutyKey = typeof body.dutyKey === 'string' ? body.dutyKey : '';
  const date = typeof body.date === 'string' ? body.date : '';
  const staffId = body.staffId;
  if (!DUTY_KEY_RE.test(dutyKey)) return json({ error: 'dutyKey is required' }, 400);
  if (!DATE_RE.test(date)) return json({ error: 'date must be YYYY-MM-DD' }, 400);
  if (!isUuid(staffId)) return json({ error: 'staffId is required' }, 400);

  const catalog = await loadDutyCatalog(db);
  const duty = catalog.find((d) => d.key === dutyKey);
  if (duty?.phase !== 'off_shift') return json({ error: 'Not an off-shift duty' }, 400);
  if (duty.archived) return json({ error: `${duty.label} is retired` }, 400);
  if (!dutyRunsOn(duty, date)) {
    return json({ error: `${duty.label} isn't done on that day of the week` }, 400);
  }

  const { data: person, error: personError } = await db
    .from('staff')
    .select('id, display_name, active')
    .eq('id', staffId)
    .maybeSingle();
  if (personError) return dbError(personError);
  if (!person) return json({ error: 'Staff member not found' }, 404);
  if (!person.active) return json({ error: `${person.display_name} is off the roster` }, 400);

  const untrained = trainingError(
    catalog,
    await loadDutyTraining(db),
    staffId,
    person.display_name as string,
    [dutyKey]
  );
  if (untrained) return json({ error: untrained }, 400);

  const { data: existing, error: fetchError } = await db
    .from('duty_assignments')
    .select('*')
    .eq('duty_key', dutyKey)
    .eq('duty_date', date)
    .maybeSingle();
  if (fetchError) return dbError(fetchError);
  const before = existing as DutyAssignmentRow | null;
  if (before?.staff_id === staffId) return json({ assignment: before });

  const email = normalizeEmail(gate.user.email);
  const now = new Date().toISOString();
  // Someone new takes the day: whatever the last person ticked isn't theirs.
  const { data, error } = before
    ? await db
        .from('duty_assignments')
        .update({
          staff_id: staffId,
          done_at: null,
          done_by: null,
          updated_by: email,
          updated_at: now,
        })
        .eq('id', before.id)
        .select('*')
        .single()
    : await db
        .from('duty_assignments')
        .insert({
          duty_key: dutyKey,
          duty_date: date,
          staff_id: staffId,
          created_by: email,
          updated_by: email,
        })
        .select('*')
        .single();
  // Two managers assigning the same day at once.
  if (error) return dbError(error, 'Someone was just assigned this — reload and try again');

  const assignment = data as DutyAssignmentRow;
  await logScheduleChange(db, {
    actor: actorFromGate(gate),
    entityType: 'duty_assignment',
    entityId: assignment.id,
    action: before ? 'update' : 'create',
    summary: before
      ? `Gave ${duty.label} on ${date} to ${person.display_name} (was ${await staffNameOf(db, before.staff_id)})`
      : `Gave ${duty.label} on ${date} to ${person.display_name}`,
    details: { before, after: assignment },
  });

  return json({ assignment }, before ? 200 : 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const gate = await gateMutation(cookies, request, '/admin/schedule');
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  if (!isUuid(body.id)) return json({ error: 'id is required' }, 400);
  const { data: existing, error: fetchError } = await db
    .from('duty_assignments')
    .select('*')
    .eq('id', body.id)
    .maybeSingle();
  if (fetchError) return dbError(fetchError);
  if (!existing) return json({ error: 'Not found' }, 404);
  const row = existing as DutyAssignmentRow;

  // The person it's assigned to, or anyone who manages the schedule.
  if (!hasScheduleManage(gate.access) && (await selfStaffId(db, gate)) !== row.staff_id) {
    return json({ error: 'Only the person on this duty or a schedule manager can update it' }, 403);
  }

  const email = normalizeEmail(gate.user.email);
  const changes: Record<string, unknown> = {};
  if (body.done !== undefined) {
    if (typeof body.done !== 'boolean') return json({ error: 'done must be true or false' }, 400);
    if (body.done !== !!row.done_at) {
      changes.done_at = body.done ? new Date().toISOString() : null;
      changes.done_by = body.done ? email : null;
    }
  }
  if (body.notes !== undefined) {
    if (body.notes !== null && typeof body.notes !== 'string') {
      return json({ error: 'notes must be a string' }, 400);
    }
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) || null : null;
    if (notes !== row.notes) changes.notes = notes;
  }
  if (Object.keys(changes).length === 0) return json({ assignment: row });

  const { data, error } = await db
    .from('duty_assignments')
    .update({ ...changes, updated_by: email, updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .select('*')
    .single();
  if (error) return dbError(error);

  const what = await describe(db, row);
  const name = await staffNameOf(db, row.staff_id);
  await logScheduleChange(db, {
    actor: actorFromGate(gate),
    entityType: 'duty_assignment',
    entityId: row.id,
    action: 'update',
    summary:
      'done_at' in changes
        ? changes.done_at
          ? `${what} done (${name})`
          : `${what} marked not done (${name})`
        : `Updated the note on ${what} (${name})`,
    details: { before: row, after: data },
  });

  return json({ assignment: data as DutyAssignmentRow });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await gateMutation(cookies, request, requireScheduleManage);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!isUuid(id)) return json({ error: 'id is required' }, 400);

  const { data: existing, error: fetchError } = await db
    .from('duty_assignments')
    .delete()
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (fetchError) return dbError(fetchError);
  if (!existing) return json({ error: 'Not found' }, 404);
  const row = existing as DutyAssignmentRow;

  await logScheduleChange(db, {
    actor: actorFromGate(gate),
    entityType: 'duty_assignment',
    entityId: row.id,
    action: 'delete',
    summary: `Took ${await describe(db, row)} off ${await staffNameOf(db, row.staff_id)}`,
    details: { before: row },
  });

  return json({ ok: true });
};
