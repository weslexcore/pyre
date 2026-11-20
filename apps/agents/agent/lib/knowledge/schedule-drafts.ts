// Pyre Agent's schedule-draft tools, for someone who manages the schedule:
// read the week's open draft, start a fresh draft, ask for a revision, and
// propose confirming or dropping parts of it. All of it goes through the
// integrations app's /api/agent/pyre as the person in the conversation,
// which checks their live schedule:manage grant on every call.
//
// This session never drafts: starting or revising opens a separate scheduler
// session (the same run the board's Draft and Revise buttons make), which
// carries the scheduling rules, the standing instructions and the only
// write path (save_proposal). And it never makes a draft live: a
// confirmation is a proposal the person applies from the chat.

import type { KnowledgeScope } from '../role';
import { callPyre, propose } from './boards';

export function getScheduleDraft(scope: KnowledgeScope, weekStart: string) {
  return callPyre(scope, null, 'schedule_draft', { weekStart });
}

export async function startScheduleDraft(
  scope: KnowledgeScope,
  sessionId: string | null,
  input: { weekStart: string; note?: string }
) {
  const result = await callPyre(scope, sessionId, 'schedule_start', input);
  if ('error' in result) return result;
  return {
    ...result,
    scheduleDraft: { weekStart: input.weekStart },
    note: 'Started, not finished: the scheduling agent is drafting the week now, which usually takes a few minutes. The chat shows its progress and the draft when it lands, and the person is notified. Do not describe the draft until get_schedule_draft shows it.',
  };
}

export async function reviseScheduleDraft(
  scope: KnowledgeScope,
  sessionId: string | null,
  input: { weekStart: string; note: string }
) {
  const result = await callPyre(scope, sessionId, 'schedule_revise', input);
  if ('error' in result) return result;
  return {
    ...result,
    scheduleDraft: { weekStart: input.weekStart },
    note: 'Sent to the scheduling agent, not done: the revised draft replaces the current one in a minute or two, and the chat shows it when it lands. Any confirmation proposed against the old draft can no longer be applied.',
  };
}

export async function proposeScheduleReview(
  scope: KnowledgeScope,
  sessionId: string | null,
  input: Record<string, unknown>
) {
  return propose(scope, sessionId, 'schedule.review', input);
}
