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
const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM, 24-hour');

/**
 * For a count or new item read out of a reply rather than the note itself:
 * the reply's replyId from get_suggestion_context, so the count is credited
 * to whoever wrote the reply, when they wrote it.
 */
const fromReply = {
  replyId: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Only when the number comes from a reply, not the note: that reply's replyId from note.replies in get_suggestion_context."
    ),
};

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
            dueDate: dateString
              .optional()
              .describe(
                'Only when the note states or implies one; otherwise it follows from severity and importance.'
              ),
            severity: z
              .enum(['critical', 'high', 'medium', 'low'])
              .describe('How bad it is if nobody acts.'),
            importance: z
              .enum(['high', 'medium', 'low'])
              .describe('How much the work matters to the business.'),
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
        z.object({
          kind: z.literal('shift_assignment.update'),
          ...common,
          payload: z
            .object({
              assignmentId: z
                .string()
                .uuid()
                .describe("The person's assignmentId from find_shift_assignments."),
              startsAt: timeString
                .optional()
                .describe('When they actually started; omit when the note only changes the end.'),
              endsAt: timeString
                .optional()
                .describe(
                  'When they actually finished; omit when the note only changes the start.'
                ),
            })
            .refine((p) => p.startsAt !== undefined || p.endsAt !== undefined, {
              message: 'Give startsAt, endsAt, or both.',
            }),
        }),
        z.object({
          kind: z.literal('inventory.count'),
          ...common,
          ...fromReply,
          payload: z
            .object({
              itemId: z
                .string()
                .uuid()
                .describe("The item's itemId from the inventory list in get_suggestion_context."),
              inStock: z
                .number()
                .min(0)
                .max(100000)
                .optional()
                .describe(
                  'A set: the number on hand as the note gives it ("3 rolls left" is 3; "out of" is 0). Send it even when it matches the stock on record: that is still a count. Omit when the note gives a change instead.'
                ),
              change: z
                .number()
                .min(-100000)
                .max(100000)
                .refine((n) => n !== 0, 'A change of 0 is no change; send inStock for a count.')
                .optional()
                .describe(
                  'A change: how much the stock moved, signed. "Used 52" is -52, "got 10 in" is 10. Applied to the stock on record when an admin approves. Omit when the note gives the number on hand.'
                ),
            })
            .refine((p) => (p.inStock === undefined) !== (p.change === undefined), {
              message: 'Give inStock (the number on hand) or change (how much it moved), not both.',
            }),
        }),
        z.object({
          kind: z.literal('inventory.create'),
          ...common,
          ...fromReply,
          payload: z.object({
            name: z
              .string()
              .min(1)
              .max(120)
              .describe(
                'What the supply is called, plainly and the way the list names things ("Earplugs", "Peppermint oil").'
              ),
            category: z
              .string()
              .max(60)
              .optional()
              .describe('A category the inventory list already uses, when one fits.'),
            location: z.string().max(120).optional().describe('Where it is kept, if the note says.'),
            vendor: z.string().max(120).optional().describe('Who it comes from, if the note says.'),
            inStock: z
              .number()
              .min(0)
              .max(100000)
              .optional()
              .describe('How many are on hand, if the note gives a number; omit otherwise.'),
            reorderAt: z
              .number()
              .min(0)
              .max(100000)
              .optional()
              .describe('Only when the note says when to re-order.'),
          }),
        }),
      ])
    )
    .max(58)
    .refine((list) => list.filter((s) => s.kind.startsWith('inventory.')).length <= 50, {
      message: 'At most 50 inventory changes.',
    })
    .refine((list) => list.filter((s) => !s.kind.startsWith('inventory.')).length <= 8, {
      message: 'At most 8 suggestions besides inventory changes.',
    })
    .describe(
      'Everything you propose for this record; empty when it needs nothing. Up to 8 tasks, comments, SOP edits and hours changes, plus one inventory suggestion for every supply the note counts (up to 50).'
    ),
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
    // Logged as well as returned: a refusal the model can fix is routine, but
    // one it can't (the integrations app unreachable or behind Deployment
    // Protection) otherwise leaves no trace outside the session.
    console.error(
      `[suggester] save_suggestions for run ${target.runId ?? '(dry run)'} refused (HTTP ${status}): ${String(body.error ?? '')}`
    );
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
