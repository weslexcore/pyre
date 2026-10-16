// Pyre Agent's goals-and-boards tools: reads (every goal and where it stands,
// one board, a card search) and proposals (a new board, a new card, a change
// to a card, a comment, a KPI reading). All of it goes through the
// integrations app's /api/agent/pyre as the person in the conversation —
// their email from the session's scope, never from the model — which
// resolves their board grants on every call and owns the progress math, so
// nothing here re-implements either. A proposal is stored pending and shown
// to the person in the chat with Apply and Dismiss; nothing here changes a
// board.

import { postAgentApi } from '../api';
import type { KnowledgeScope } from '../role';

export type ProposalKind =
  | 'board.create'
  | 'board_card.create'
  | 'board_card.update'
  | 'board_card.comment'
  | 'goal_kpi.measure';

async function callPyre(
  scope: KnowledgeScope,
  sessionId: string | null,
  op: 'goals' | 'board' | 'cards' | 'propose',
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!scope.boards) {
    return { error: 'This person has no boards, so there are no goals or tasks to show them.' };
  }
  if (!scope.email) return { error: 'This session has no asker email; boards are unavailable.' };
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
