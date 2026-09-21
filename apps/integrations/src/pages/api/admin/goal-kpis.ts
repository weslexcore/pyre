// The KPIs hanging off a goal: the numbers that say whether it was met, as
// opposed to whether the tasks under it got done.
//
// Every one of them is hand-measured today, which is the thing that makes
// them go stale — so a change to `currentValue` is not an ordinary column
// write. It stamps `measured_at`/`measured_by` and writes a `kpi_updated`
// line to the trail, and the board page shows "measured N days ago" beside
// the meter. A number with no date on it looks like news forever.
//
// Two levels of access. Defining a KPI — its name, direction, target — and
// removing one is reshaping the goal, which needs the whole tool
// (canManageBoards). Typing in the measurement is working the goal, which
// anyone who can open a board serving it may do: the community manager on
// the rental pipeline is the one who knows how many rentals were booked.
//
//   POST   { goalId, name, unit?, direction, startValue?, targetValue } → { kpi } 201
//   PATCH  { id, name?, unit?, direction?, startValue?, targetValue?,
//            currentValue?, sortOrder? } → { kpi }
//   DELETE ?id=<uuid> → { ok: true }

import { BOARDS_HREF } from '@/components/admin/adminTools';
import { canManageBoards } from '@/lib/boards/access';
import { logBoardEvent } from '@/lib/boards/events';
import {
  type APIRoute,
  beginDelete,
  beginMutation,
  type Db,
  isUuidParam,
  json,
} from '@/lib/boards/route';
import { canReachGoal } from '@/lib/boards/store';
import type { GoalKpiRow } from '@/lib/db';
import { parseKpiCreate, parseKpiMeasure, parseKpiPatch } from '@/lib/goals/validate';

export const POST: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, email, body, gate } = ready;
  if (!canManageBoards(gate.access)) return json({ error: 'Forbidden' }, 403);

  const parsed = parseKpiCreate(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const { data: goal, error: goalError } = await db
    .from('goals')
    .select('id')
    .eq('id', parsed.value.goal_id)
    .maybeSingle();
  if (goalError) return json({ error: goalError.message }, 500);
  if (!goal) return json({ error: 'Goal not found' }, 404);

  const { data, error } = await db
    .from('goal_kpis')
    .insert({
      ...parsed.value,
      sort_order: await nextSortOrder(db, parsed.value.goal_id),
      created_by: email,
    })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  const kpi = data as GoalKpiRow;
  await logBoardEvent(db, {
    goalId: kpi.goal_id,
    action: 'updated',
    actor: email,
    detail: { kpi: { from: null, to: kpi.name } },
  });
  return json({ kpi }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, email, body, gate } = ready;

  if (!isUuidParam(body.id)) return json({ error: 'id must be a UUID' }, 400);
  const id = body.id;

  const parsed = parseKpiPatch(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const patch = parsed.value;

  const { data: beforeRow, error: beforeError } = await db
    .from('goal_kpis')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (beforeError) return json({ error: beforeError.message }, 500);
  const before = (beforeRow as GoalKpiRow) ?? null;
  if (!before) return json({ error: 'KPI not found' }, 404);

  // Somebody holding one board may type in the number and nothing else —
  // the body must be exactly the measurement, and the goal must be on a
  // board they hold. Not-yours reads as not-found, as everywhere in the tool.
  if (!canManageBoards(gate.access)) {
    const onlyMeasure =
      parseKpiMeasure(body).ok &&
      Object.keys(body).every((key) => key === 'id' || key === 'currentValue');
    if (!onlyMeasure) return json({ error: 'Forbidden' }, 403);
    if (!(await canReachGoal(db, gate.access, before.goal_id))) {
      return json({ error: 'KPI not found' }, 404);
    }
  }

  // A measurement carries a date and a name, or it is just a number in a box.
  const measured = 'current_value' in patch && patch.current_value !== before.current_value;
  const now = new Date().toISOString();
  const measurement = measured
    ? patch.current_value === null
      ? { measured_at: null, measured_by: null }
      : { measured_at: now, measured_by: email }
    : {};

  const { data, error } = await db
    .from('goal_kpis')
    .update({ ...patch, ...measurement, updated_by: email })
    .eq('id', id)
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  const kpi = data as GoalKpiRow;
  if (measured) {
    await logBoardEvent(db, {
      goalId: kpi.goal_id,
      action: 'kpi_updated',
      actor: email,
      detail: {
        kpi_id: kpi.id,
        name: kpi.name,
        from: before.current_value,
        to: kpi.current_value,
      },
    });
  }
  return json({ kpi });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const ready = await beginDelete(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, email, gate } = ready;
  if (!canManageBoards(gate.access)) return json({ error: 'Forbidden' }, 403);

  const id = url.searchParams.get('id');
  if (!isUuidParam(id)) return json({ error: 'id must be a UUID' }, 400);

  const { data: row } = await db.from('goal_kpis').select('*').eq('id', id).maybeSingle();
  const kpi = (row as GoalKpiRow) ?? null;
  if (!kpi) return json({ error: 'KPI not found' }, 404);

  const { error } = await db.from('goal_kpis').delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);

  await logBoardEvent(db, {
    goalId: kpi.goal_id,
    action: 'updated',
    actor: email,
    detail: { kpi: { from: kpi.name, to: null } },
  });
  return json({ ok: true });
};

/** After the KPIs already on the goal, so the list reads in writing order. */
async function nextSortOrder(db: Db, goalId: string): Promise<number> {
  const { data } = await db
    .from('goal_kpis')
    .select('sort_order')
    .eq('goal_id', goalId)
    .order('sort_order', { ascending: false })
    .limit(1);
  const highest = ((data ?? []) as { sort_order: number }[])[0]?.sort_order ?? 0;
  return highest + 10;
}
