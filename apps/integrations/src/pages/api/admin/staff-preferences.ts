// Scheduling preferences for /admin/schedule/hours: a person's h/wk target and
// shifts-per-week range (min / preferred / max), which the AI drafter plans
// around. Managers (schedule:manage / admins) edit anyone's; everyone else
// with the schedule page edits only their own — "own" means the staff row
// whose email matches their login. Pay, roles, and access stay on
// /admin/users (/api/admin/users), which is admin-only.

import type { APIRoute } from 'astro';
import { hasScheduleManage } from '@/components/admin/adminTools';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { getDb, redactCalendarToken, type StaffRow } from '@/lib/db';
import {
  actorFromGate,
  changedFields,
  logScheduleChange,
  summarizeDiff,
} from '@/lib/schedule/change-log';
import { parseShiftPrefs } from '@/lib/schedule/shift-prefs';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, '/admin/schedule');
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const id = String(body.id ?? '');
  if (!id) return json({ error: 'Missing id' }, 400);

  const { data: rowData, error: rowError } = await db
    .from('staff')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (rowError) return json({ error: rowError.message }, 500);
  const row = rowData as StaffRow | null;
  if (!row) return json({ error: 'No such person' }, 404);

  if (!hasScheduleManage(gate.access)) {
    const email = (gate.user.email ?? '').toLowerCase();
    if (!email || (row.email ?? '').toLowerCase() !== email) {
      return json({ error: 'You can only change your own preferences' }, 403);
    }
  }

  const fields = parseShiftPrefs(body, row);
  if ('error' in fields) return json({ error: fields.error }, 400);
  if (Object.keys(fields).length === 0) return json({ error: 'Nothing to update' }, 400);

  const { data, error } = await db.from('staff').update(fields).eq('id', id).select('*').single();
  if (error) return json({ error: error.message }, 500);

  const diff = changedFields(row as unknown as Record<string, unknown>, fields);
  if (diff) {
    await logScheduleChange(db, {
      actor: actorFromGate(gate),
      entityType: 'staff_prefs',
      entityId: id,
      action: 'update',
      summary: `${row.display_name}'s preferences: ${summarizeDiff(diff)}`,
      details: diff,
    });
  }

  return json({ person: redactCalendarToken(data as StaffRow) });
};
