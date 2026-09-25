// Save the suggester's proposals for admin review via the integrations app,
// which checks each against the live boards, cards and SOPs and files them as
// pending. Validation errors come back verbatim (with the index of the
// suggestion to fix) so the model can correct and resubmit. The run and the
// record come from the session's auth, never from the model. A session with
// no run (evals), or AGENT_FORCE_DRY_RUN=1, validates without writing.

import { z } from 'zod';
import { postAgentApi } from '../api';
import type { SuggestTarget } from '../role';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

const common = {
  rationale: z
    .string()
    .min(1)
    .max(2000)
    .describe('One or two sentences for the admin: why this, and why this board or card.'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('How sure you are the admin will want this, 0–1.'),
};

export const saveSuggestionsInput = z.object({
  suggestions: z
    .array(
      z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('board_card.create'),
          ...common,
          payload: z.object({
            board: z.string().min(1).describe('A board slug from get_suggestion_context.'),
            columnKey: z
              .string()
              .optional()
              .describe("An open column's key; omit for the board's first open column."),
            title: z.string().min(1).max(200).describe('Short and imperative.'),
            notesMd: z
              .string()
              .max(4000)
              .optional()
              .describe('What whoever picks it up needs to know.'),
            dueDate: dateString.optional().describe('Only when the note states or implies one.'),
            properties: z
              .record(
                z.string(),
                z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])
              )
              .optional()
              .describe(
                "Answers to the board's fields, by field key; only ones the note supports."
              ),
          }),
        }),
        z.object({
          kind: z.literal('board_card.comment'),
          ...common,
          payload: z.object({
            cardId: z.string().uuid().describe('An open card from search_open_cards.'),
            note: z.string().min(1).max(3000).describe('What is new since the card was filed.'),
          }),
        }),
        z.object({
          kind: z.literal('sop.edit'),
          ...common,
          payload: z.object({
            slug: z.string().min(1),
            baseVersion: z
              .number()
              .int()
              .min(1)
              .describe('The version read_sop_for_edit returned.'),
            edits: z
              .array(
                z.object({
                  find: z
                    .string()
                    .min(1)
                    .describe('Exact text from the document, long enough to match one place.'),
                  replace: z.string().describe('What it becomes; empty to delete it.'),
                })
              )
              .min(1)
              .max(20),
            changeNote: z.string().min(1).max(300).describe('The change, in plain words.'),
          }),
        }),
      ])
    )
    .max(8)
    .describe('Everything you propose for this record; empty when it needs nothing.'),
});

export type SaveSuggestionsInput = z.infer<typeof saveSuggestionsInput>;

export const SAVE_SUGGESTIONS_DESCRIPTION =
  'Save your proposals for this record for an admin to review; nothing is applied until an admin approves it. Call exactly once, at the end, with every suggestion (or an empty list when the record needs nothing). On an error, fix the suggestion it names and call again with the whole list.';

export async function saveSuggestions(
  input: SaveSuggestionsInput,
  target: SuggestTarget,
  sessionId: string | null
) {
  const dryRun = process.env.AGENT_FORCE_DRY_RUN === '1' || !target.runId;
  const { status, body } = await postAgentApi('/api/agent/suggestions', {
    runId: target.runId,
    agentSessionId: sessionId,
    dryRun,
    suggestions: input.suggestions,
  });
  if (status >= 400) {
    return {
      saved: false,
      status,
      error: body.error ?? 'Unknown error',
      ...(typeof body.index === 'number' ? { suggestionIndex: body.index } : {}),
    };
  }
  return dryRun
    ? { saved: false, dryRun: true, valid: true, count: input.suggestions.length }
    : { saved: true, count: body.count ?? input.suggestions.length };
}
