// Review actions for agent draft proposals, from the schedule board:
//   approve      — accept the whole batch (draft rows go live)
//   discard      — reject the whole batch (draft rows deleted)
//   accept-item  — one draft shift/assignment goes live
//   reject-item  — one draft shift/assignment is deleted
// Accepting an assignment on a still-draft shift accepts that shift too (a
// live assignment must never point at an invisible shift). When a proposal
// has no draft rows left after an item action, it auto-resolves to approved.

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireScheduleManage } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import {
  actorFromGate,
  describeShift,
  logScheduleChange,
  staffNameOf,
} from '@/lib/schedule/change-log';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requireScheduleManage(cookies);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const action = body.action;
  const now = new Date().toISOString();

  if (action === 'approve' || action === 'discard') {
    const proposalId = body.proposalId;
    if (typeof proposalId !== 'string' || !proposalId) {
      return json({ error: 'proposalId is required' }, 400);
    }

    const { data: proposal, error: fetchError } = await db
      .from('schedule_proposals')
      .select('id, status, week_start')
      .eq('id', proposalId)
      .maybeSingle();
    if (fetchError) return json({ error: fetchError.message }, 500);
    if (!proposal) return json({ error: 'Proposal not found' }, 404);
    if (proposal.status !== 'draft') return json({ error: 'Proposal is not open' }, 409);

    const ops =
      action === 'approve'
        ? [
            db
              .from('shifts')
              .update({ is_draft: false })
              .eq('proposal_id', proposalId)
              .eq('is_draft', true),
            db
              .from('shift_assignments')
              .update({ is_draft: false })
              .eq('proposal_id', proposalId)
              .eq('is_draft', true),
            db
              .from('schedule_proposals')
              .update({ status: 'approved', decided_at: now })
              .eq('id', proposalId),
          ]
        : [
            db
              .from('shift_assignments')
              .delete()
              .eq('proposal_id', proposalId)
              .eq('is_draft', true),
            db.from('shifts').delete().eq('proposal_id', proposalId).eq('is_draft', true),
            db
              .from('schedule_proposals')
              .update({ status: 'discarded', decided_at: now })
              .eq('id', proposalId),
          ];
    for (const op of ops) {
      const { error } = await op;
      if (error) return json({ error: error.message }, 500);
    }

    await logScheduleChange(db, {
      actor: actorFromGate(gate),
      entityType: 'proposal',
      entityId: proposalId,
      action: action === 'approve' ? 'approve' : 'discard',
      summary: `${action === 'approve' ? 'Approved' : 'Discarded'} draft schedule for week of ${proposal.week_start}`,
    });

    return json({ ok: true });
  }

  if (action === 'accept-item' || action === 'reject-item') {
    const kind = body.kind;
    const id = body.id;
    if ((kind !== 'shift' && kind !== 'assignment') || typeof id !== 'string' || !id) {
      return json({ error: "kind ('shift'|'assignment') and id are required" }, 400);
    }
    const table = kind === 'shift' ? 'shifts' : 'shift_assignments';

    // Plain string keeps supabase-js from literal-parsing the ternary select
    // (the union of column lists defeats its parser); shape the row ourselves.
    const columns: string =
      kind === 'shift'
        ? 'id, proposal_id, is_draft, label, shift_date'
        : 'id, proposal_id, is_draft, shift_id, staff_id';
    const { data, error: fetchError } = await db
      .from(table)
      .select(columns)
      .eq('id', id)
      .maybeSingle();
    if (fetchError) return json({ error: fetchError.message }, 500);
    const row = data as {
      id: string;
      proposal_id: string | null;
      is_draft: boolean;
      shift_id?: string;
      staff_id?: string;
      label?: string;
      shift_date?: string;
    } | null;
    if (!row || !row.is_draft) return json({ error: 'Draft item not found' }, 404);

    if (action === 'accept-item') {
      const { error } = await db.from(table).update({ is_draft: false }).eq('id', id);
      if (error) return json({ error: error.message }, 500);
      // A live assignment must never reference a draft shift.
      if (kind === 'assignment') {
        const { error: shiftError } = await db
          .from('shifts')
          .update({ is_draft: false })
          .eq('id', (row as { shift_id: string }).shift_id)
          .eq('is_draft', true);
        if (shiftError) return json({ error: shiftError.message }, 500);
      }
    } else {
      const { error } = await db.from(table).delete().eq('id', id);
      if (error) return json({ error: error.message }, 500);
    }

    const accepted = action === 'accept-item';
    const itemDescription =
      kind === 'shift'
        ? `draft shift ${describeShift(row as { label: string; shift_date: string })}`
        : `draft assignment for ${await staffNameOf(db, row.staff_id as string)}`;
    await logScheduleChange(db, {
      actor: actorFromGate(gate),
      entityType: kind === 'shift' ? 'shift' : 'assignment',
      entityId: row.id,
      action: accepted ? 'accept_item' : 'reject_item',
      summary: `${accepted ? 'Accepted' : 'Rejected'} ${itemDescription}`,
      details: { proposalId: row.proposal_id },
    });

    // Auto-resolve the proposal when nothing is left to review.
    const proposalId = row.proposal_id as string | null;
    if (proposalId) {
      const [shiftsLeft, assignmentsLeft] = await Promise.all([
        db
          .from('shifts')
          .select('id', { count: 'exact', head: true })
          .eq('proposal_id', proposalId)
          .eq('is_draft', true),
        db
          .from('shift_assignments')
          .select('id', { count: 'exact', head: true })
          .eq('proposal_id', proposalId)
          .eq('is_draft', true),
      ]);
      if (
        !shiftsLeft.error &&
        !assignmentsLeft.error &&
        !shiftsLeft.count &&
        !assignmentsLeft.count
      ) {
        await db
          .from('schedule_proposals')
          .update({ status: 'approved', decided_at: now })
          .eq('id', proposalId)
          .eq('status', 'draft');
      }
    }
    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, 400);
};
