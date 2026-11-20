// Pyre Agent's SOP, message and inventory suggestions, and the message reads
// they need.
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

/** One inventory change read out of a shift note, as the model sends it. */
export type InventoryChange =
  | {
      kind: 'inventory.count';
      itemId: string;
      /** A set: the number on hand. */
      inStock?: number;
      /** A change: how much it moved, signed ("used 52" is -52). */
      change?: number;
      shiftNoteId?: string;
      rationale: string;
    }
  | {
      kind: 'inventory.create';
      name: string;
      category?: string;
      location?: string;
      vendor?: string;
      inStock?: number;
      reorderAt?: number;
      shiftNoteId?: string;
      rationale: string;
    };

/**
 * File the inventory changes read out of shift notes as one batch: counts on
 * items the list has, new items for supplies it doesn't. They are reviewed —
 * and can be approved — together; each count is credited to the note it
 * came from.
 */
export async function suggestInventory(
  scope: KnowledgeScope,
  sessionId: string | null,
  changes: InventoryChange[]
) {
  if (!sessionId) return { error: 'No session to attach the suggestions to.' };
  const result = await callPyre(scope, sessionId, 'suggest_inventory', { changes });
  if ('error' in result) return result;
  const reviewer = result.reviewer === 'you' ? 'you' : 'admins';
  return {
    ...result,
    note:
      reviewer === 'you'
        ? 'Suggested, not applied: they show in the chat as one inventory update the person can edit row by row and approve all at once, and nothing changes until they approve.'
        : 'Suggested, not applied: they went to the admins as one inventory update (they were notified), and nothing changes until one of them approves. The person sees their status in the chat.',
  };
}
