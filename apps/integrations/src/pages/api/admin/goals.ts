// Goals (/admin/goals). A goal is the unit of work: what we are trying to
// achieve, the KPIs that say whether we got there (goal-kpis.ts), and every
// card filed under it (board-cards.ts).
//
// The one rule worth stating out loud: **nothing here closes a goal on its
// own.** A PATCH to status 'completed' is a person pressing a button, and the
// route records what was true at that moment — how many KPIs were met, how
// much work was still open — alongside the note they wrote. A goal with all
// twelve tasks done and a KPI short stays open until somebody decides
// otherwise, which is the judgement the Trello board had nowhere to put.
//
// Goals nest one level and no further; the app enforces that, because the
// on-delete-restrict foreign key can only stop a parent from vanishing.
//
//   GET                 → { goals, kpis, cards, columns, boards, people, today }
//   GET ?id=<uuid>      → { goal, parent, children, kpis, cards, columns,
//                           boards, goals, people, today }
//   POST   { title, parentId?, descriptionMd?, status?, ownerEmail?, area?,
//            targetDate? } → { goal } 201
//   PATCH  { id, ...any of the above, sortOrder?, completionNote? } → { goal }
//   DELETE ?id=<uuid>   → { ok: true }

import { GOALS_HREF } from '@/components/admin/adminTools';
import { type BoardEventInput, logBoardEvent, logBoardEvents } from '@/lib/boards/events';
import { eventsForGoalPatch } from '@/lib/boards/diff';
import {
  type APIRoute,
  type Db,
  beginDelete,
  beginMutation,
  beginRead,
  isUuidParam,
  json,
  storeError,
} from '@/lib/boards/route';
import type { BoardCardRow, BoardColumnRow, GoalKpiRow, GoalRow } from '@/lib/db';
import { canBeParent, completionPreview, goalStatusPatch } from '@/lib/goals/access';
import { loadGoalPage, loadGoalsIndex } from '@/lib/goals/store';
import { parseGoalCreate, parseGoalPatch } from '@/lib/goals/validate';

export const GET: APIRoute = async ({ cookies, url }) => {
  const ready = await beginRead(cookies, GOALS_HREF);
  if (ready instanceof Response) return ready;

  const id = url.searchParams.get('id');
  try {
    if (id) {
      if (!isUuidParam(id)) return json({ error: 'id must be a UUID' }, 400);
      const page = await loadGoalPage(ready.db, id);
      if (!page) return json({ error: 'Goal not found' }, 404);
      return json(page);
    }
    return json(await loadGoalsIndex(ready.db));
  } catch (e) {
    return storeError('goals', e);
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, GOALS_HREF);
  if (ready instanceof Response) return ready;
  const { db, email, body } = ready;

  const parsed = parseGoalCreate(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  if (parsed.value.parent_id) {
    const refused = await refuseBadParent(db, parsed.value.parent_id, null);
    if (refused) return refused;
  }

  // A goal created straight into 'active' has started today; one created
  // planned has not started at all.
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('goals')
    .insert({
      ...parsed.value,
      started_at: parsed.value.status === 'active' ? now : null,
      created_by: email,
    })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  const goal = data as GoalRow;
  await logBoardEvent(db, { goalId: goal.id, action: 'created', actor: email });
  return json({ goal }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, GOALS_HREF);
  if (ready instanceof Response) return ready;
  const { db, email, body } = ready;

  if (!isUuidParam(body.id)) return json({ error: 'id must be a UUID' }, 400);
  const id = body.id;

  const parsed = parseGoalPatch(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const patch = parsed.value;

  const before = await loadGoal(db, id);
  if (!before) return json({ error: 'Goal not found' }, 404);

  if (patch.parent_id) {
    const refused = await refuseBadParent(db, patch.parent_id, id);
    if (refused) return refused;
  }

  const now = new Date().toISOString();
  // A status change is never just a column: it carries started_at the first
  // time a goal goes active and the completion stamp on the way in and out.
  const statusColumns =
    patch.status !== undefined ? goalStatusPatch(before, patch.status, email, now) : {};

  // Completion is a decision, so it is logged with the evidence in front of
  // the person who made it rather than as "status: active -> completed".
  const completing = patch.status === 'completed' && before.status !== 'completed';
  const preview = completing ? await previewFor(db, before) : null;

  const { data, error } = await db
    .from('goals')
    .update({ ...patch, ...statusColumns, updated_by: email })
    .eq('id', id)
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  const goal = data as GoalRow;

  const events: BoardEventInput[] = eventsForGoalPatch(before, { ...patch, ...statusColumns })
    // The completed event below says it better than a status line would.
    .filter((event) => !(completing && event.action === 'status_changed'))
    .map((event) => ({ ...event, goalId: id, actor: email }));

  if (completing && preview) {
    events.push({
      goalId: id,
      action: 'completed',
      actor: email,
      detail: { ...preview },
      note: goal.completion_note,
    });
  }
  await logBoardEvents(db, events);

  return json({ goal });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const ready = await beginDelete(cookies, request, GOALS_HREF);
  if (ready instanceof Response) return ready;
  const { db, email } = ready;

  const id = url.searchParams.get('id');
  if (!isUuidParam(id)) return json({ error: 'id must be a UUID' }, 400);

  // Deleting a goal that carries work would either orphan the cards or take
  // them with it, and neither is what anybody means by "remove this from the
  // list". 'dropped' is: it keeps the goal, its tasks, and the reasoning.
  const [{ count: childCount, error: childError }, { count: cardCount, error: cardError }] =
    await Promise.all([
      db.from('goals').select('id', { count: 'exact', head: true }).eq('parent_id', id),
      db.from('board_cards').select('id', { count: 'exact', head: true }).eq('goal_id', id),
    ]);
  if (childError) return json({ error: childError.message }, 500);
  if (cardError) return json({ error: cardError.message }, 500);

  if ((childCount ?? 0) > 0) {
    return json(
      { error: 'This goal has sub-goals. Re-file them first, or mark it dropped.' },
      409
    );
  }
  if ((cardCount ?? 0) > 0) {
    return json(
      { error: 'This goal has tasks filed under it. Re-file them first, or mark it dropped.' },
      409
    );
  }

  const { error } = await db.from('goals').delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);

  console.info(`[goals] ${email} deleted goal ${id}`);
  return json({ ok: true });
};

async function loadGoal(db: Db, id: string): Promise<GoalRow | null> {
  const { data } = await db.from('goals').select('*').eq('id', id).maybeSingle();
  return (data as GoalRow) ?? null;
}

/**
 * The 400 for a parent that would make a grandparent, name a goal that isn't
 * there, or point a goal at itself. Null when the parent is fine.
 */
async function refuseBadParent(db: Db, parentId: string, childId: string | null) {
  const parent = await loadGoal(db, parentId);
  if (!parent) return json({ error: 'That parent goal does not exist' }, 400);
  if (!canBeParent(parent, childId)) {
    return json({ error: 'Goals nest one level: that goal already has a parent' }, 400);
  }
  if (childId) {
    const { count, error } = await db
      .from('goals')
      .select('id', { count: 'exact', head: true })
      .eq('parent_id', childId);
    if (error) return json({ error: error.message }, 500);
    if ((count ?? 0) > 0) {
      return json({ error: 'Goals nest one level: this goal already has sub-goals' }, 400);
    }
  }
  return null;
}

/** The KPI and open-task counts a completion is recorded against. */
async function previewFor(db: Db, goal: GoalRow) {
  const { data: childRows } = await db.from('goals').select('id').eq('parent_id', goal.id);
  const family = [goal.id, ...((childRows ?? []) as { id: string }[]).map((row) => row.id)];

  const [kpisResult, cardsResult, columnsResult] = await Promise.all([
    db.from('goal_kpis').select('*').in('goal_id', family),
    db.from('board_cards').select('*').in('goal_id', family),
    db.from('board_columns').select('*'),
  ]);

  const columns = new Map(
    ((columnsResult.data ?? []) as BoardColumnRow[]).map((column) => [column.id, column])
  );
  return completionPreview(
    (kpisResult.data ?? []) as GoalKpiRow[],
    (cardsResult.data ?? []) as BoardCardRow[],
    columns
  );
}
