// Pyre Agent's SOP and message suggestions, and the message reads they need.
// A suggestion is not a proposal: it is filed in the same pipeline as the
// shift-note suggester's (the integrations app's lib/pyre-agent/suggestions)
// and decided by whoever decides suggestions — the person in the chat when
// they are an admin or hold the Suggestions page, the admins otherwise.
// Everything goes through /api/agent/pyre as the person (./boards callPyre),
// which checks they can read the SOP or message the suggestion is about.

import type { KnowledgeScope } from '../role';
import { callPyre } from './boards';

export type SuggestionKind = 'sop.edit' | 'message.create' | 'message.edit';

export function getMessages(
  scope: KnowledgeScope,
  input: { query?: string; limit?: number; includeArchived?: boolean }
) {
  return callPyre(scope, null, 'messages', input as Record<string, unknown>);
}

export function readMessage(scope: KnowledgeScope, id: string) {
  return callPyre(scope, null, 'message', { id });
}

/**
 * File one suggestion from the conversation. The result says who decides
 * it, so the answer can say "suggested" and where it went — never "done".
 */
export async function suggest(
  scope: KnowledgeScope,
  sessionId: string | null,
  kind: SuggestionKind,
  input: { rationale: string } & Record<string, unknown>
) {
  if (!sessionId) return { error: 'No session to attach the suggestion to.' };
  const { rationale, ...payload } = input;
  const result = await callPyre(scope, sessionId, 'suggest', { kind, payload, rationale });
  if ('error' in result) return result;
  const reviewer = result.reviewer === 'you' ? 'you' : 'admins';
  return {
    ...result,
    note:
      reviewer === 'you'
        ? 'Suggested, not applied: it shows in the chat as an editable suggestion with Approve and Dismiss, and nothing changes until they approve it.'
        : 'Suggested, not applied: it went to the admins for review (they were notified), and nothing changes until one of them approves it. The person sees its status in the chat.',
  };
}
