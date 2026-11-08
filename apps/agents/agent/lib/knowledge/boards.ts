// Pyre Agent's goals-and-boards tools: reads (every goal and where it stands,
// one board, a card search) and proposals (a new board, a new card, a change
// to a card, a comment, a KPI reading). All of it goes through the
// integrations app's /api/agent/pyre as the person in the conversation —
// their email from the session's scope, never from the model — which
// resolves their board grants on every call and owns the progress math, so
// nothing here re-implements either. A proposal is stored pending and shown
// to the person in the chat with Apply and Dismiss; nothing here changes a
// board. The inventory tools (./inventory) share the same call.

import { postAgentApi } from '../api';
import type { KnowledgeScope } from '../role';

export type ProposalKind =
  | 'board.create'
  | 'board_card.create'
  | 'board_card.update'
  | 'board_card.comment'
  | 'goal_kpi.measure'
  | 'inventory.update'
  | 'inventory.create';

export type PyreOp = 'goals' | 'board' | 'cards' | 'inventory' | 'propose';

/** Which page an op or proposal needs the person to hold. */
export function areaOf(op: PyreOp, kind?: ProposalKind): 'boards' | 'inventory' {
  if (op === 'inventory') return 'inventory';
  if (op === 'propose' && kind?.startsWith('inventory.')) return 'inventory';
  return 'boards';
}

/**
 * One call to /api/agent/pyre as the person. Refused here, before the
 * network, when the scope says they do not hold the page the op reads; the
 * integrations app checks again with their live grants.
 */
export async function callPyre(
  scope: KnowledgeScope,
  sessionId: string | null,
  op: PyreOp,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const area = areaOf(op, input.kind as ProposalKind | undefined);
  if (area === 'boards' && !scope.boards) {
    return { error: 'This person has no boards, so there are no goals or tasks to show them.' };
  }
  if (area === 'inventory' && !scope.inventory) {
    return { error: 'This person does not hold the Inventory page, so the list is not available.' };
  }
  if (!scope.email) return { error: 'This session has no asker email; this is unavailable.' };
  const { status, body } = await postAgentApi('/api/agent/pyre', {
    email: scope.email,
    sessionId,
    op,
    input,
  });
  if (status >= 400) {
    return { error: typeof body.error === 'string' ? body.error : `Request failed (HTTP ${status})` };
  }
  return body;
}

export function getGoalsAndBoards(scope: KnowledgeScope) {
  return callPyre(scope, null, 'goals', {});
}

export function readBoard(scope: KnowledgeScope, slug: string) {
  return callPyre(scope, null, 'board', { slug });
}

export function findCards(scope: KnowledgeScope, input: Record<string, unknown>) {
  return callPyre(scope, null, 'cards', input);
}

/**
 * Store one proposal for the person to apply. The result tells the model it
 * is waiting on them — so the answer says "proposed", never "done".
 */
export async function propose(
  scope: KnowledgeScope,
  sessionId: string | null,
  kind: ProposalKind,
  input: Record<string, unknown>
) {
  if (!sessionId) return { error: 'No session to attach the proposal to.' };
  const result = await callPyre(scope, sessionId, 'propose', { ...input, kind });
  if ('error' in result) return result;
  return {
    ...result,
    note: 'Proposed, not applied: it shows in the chat with Apply and Dismiss, and nothing changes until the person presses Apply.',
  };
}
