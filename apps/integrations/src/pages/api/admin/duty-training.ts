// Who is trained on a duty (/admin/schedule/duties).
//   PUT { key, staffIds: [...] }  — the full list of people trained on `key`;
//                                   anyone left out is no longer trained
//
// Read through GET /api/admin/shift-duties, beside the duty list itself.
// Needs schedule:manage, like editing the list and assigning duties. Taking
// someone's training off never rewrites a shift they already hold the duty
// on — the duty stays there and the board flags it — it only stops them
// being given it again while the duty requires training.

import type { APIRoute } from 'astro';
import { requireScheduleManage } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import { normalizeEmail } from '@/lib/email/address';
import { dbError, gateMutation, isUuid, json, readJsonBody } from '@/lib/http/route';
import { actorFromGate, logScheduleChange } from '@/lib/schedule/change-log';
import {
  invalidateDutyTraining,
  loadDutyCatalog,
  loadDutyTrainingRows,
} from '@/lib/schedule/duties';
import { DUTY_KEY_RE } from '@/lib/schedule/duty-validate';

export const prerender = false;

export const PUT: APIRoute = async ({ cookies, request }) => {
  const gate = await gateMutation(cookies, request, requireScheduleManage);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!DUTY_KEY_RE.test(key)) return json({ error: 'key is required' }, 400);
  if (!Array.isArray(body.staffIds) || body.staffIds.some((id) => !isUuid(id))) {
    return json({ error: 'staffIds must be a list of staff ids' }, 400);
  }
  const wanted = new Set(body.staffIds as string[]);

  const duty = (await loadDutyCatalog(db)).find((d) => d.key === key);
  if (!duty) return json({ error: 'Duty not found' }, 404);

  const { data: staffRows, error: staffError } = await db.from('staff').select('id, display_name');
  if (staffError) return dbError(staffError);
  const nameById = new Map(
    ((staffRows ?? []) as Array<{ id: string; display_name: string }>).map((s) => [
      s.id,
      s.display_name,
    ])
  );
  const unknown = [...wanted].find((id) => !nameById.has(id));
  if (unknown) return json({ error: 'Unknown staff id' }, 400);

  invalidateDutyTraining();
  const current = new Set(
    (await loadDutyTrainingRows(db)).filter((r) => r.duty_key === key).map((r) => r.staff_id)
  );
  const added = [...wanted].filter((id) => !current.has(id));
  const removed = [...current].filter((id) => !wanted.has(id));
  if (added.length === 0 && removed.length === 0) return json({ ok: true });

  const email = normalizeEmail(gate.user.email);
  if (added.length > 0) {
    const { error } = await db.from('staff_duty_training').upsert(
      added.map((staffId) => ({ staff_id: staffId, duty_key: key, trained_by: email })),
      { onConflict: 'staff_id,duty_key', ignoreDuplicates: true }
    );
    if (error) return dbError(error);
  }
  if (removed.length > 0) {
    const { error } = await db
      .from('staff_duty_training')
      .delete()
      .eq('duty_key', key)
      .in('staff_id', removed);
    if (error) return dbError(error);
  }
  invalidateDutyTraining();

  const names = (ids: string[]) => ids.map((id) => nameById.get(id) ?? 'Unknown staff').join(', ');
  const parts = [
    added.length > 0 ? `trained: ${names(added)}` : null,
    removed.length > 0 ? `no longer trained: ${names(removed)}` : null,
  ].filter(Boolean);
  await logScheduleChange(db, {
    actor: actorFromGate(gate),
    entityType: 'duty_training',
    action: 'update',
    summary: `${duty.label} — ${parts.join('; ')}`,
    details: { dutyKey: key, added, removed },
  });

  return json({ ok: true });
};
