// Multi-turn refinement: the first turn drafts the week, the second sends a
// follow-up the way the board's "Revise draft" composer does (see
// buildRefineMessage in apps/integrations/src/lib/schedule/draft-prompt.ts).
// The agent must re-read the week context (the board may have moved since
// its draft), apply the change, keep the rest stable, and resubmit the FULL
// set — the save supersedes the previous draft.

import { defineEval } from 'eve/evals';

export default defineEval({
  description: 'Refines its own draft on a follow-up turn: re-reads context, resubmits in full',
  async test(t) {
    const draftTurn = await t.send(
      'Draft the staffing schedule for next week. ' +
        'Use get_week_context with no weekStart, then save exactly one proposal. ' +
        'Fill only shifts that are still below their staffNeeded count.'
    );

    draftTurn.toolOrder(['get_week_context', 'save_proposal']);
    draftTurn.calledTool('save_proposal');
    draftTurn.noFailedActions();

    const refineTurn = await t.send(
      'The admin reviewed your current draft for next week and wants changes. ' +
        'Call get_week_context again before doing anything else — items may have been ' +
        'accepted, rejected, or edited since your last draft, and accepted items are now live ' +
        'assignments you must schedule around, never re-propose. Apply the requested changes, ' +
        'keep everything else from your previous draft stable, and call save_proposal once with ' +
        'the FULL updated assignment set — it supersedes the prior draft automatically, so a ' +
        'partial set would silently drop the rest. The hard rules in your instructions still ' +
        'win over the note. Open the rationale with a short "What changed:" line.\n' +
        '<admin-note>\nTake one of the people you placed on a weekend shift off it and cover ' +
        'that slot with someone else who is free.\n</admin-note>'
    );

    // The refinement turn must re-read the board before saving the revision.
    refineTurn.toolOrder(['get_week_context', 'save_proposal']);
    refineTurn.calledTool('save_proposal');
    refineTurn.noFailedActions();

    t.maxToolCalls(10);

    t.judge.autoevals.closedQA(
      "The assistant's second rationale opens with a short \"What changed\" summary describing " +
        'the swap it made, keeps the rest of the week as previously drafted rather than ' +
        'reshuffling unrelated placements, and does not claim to have broken availability or ' +
        'staffing limits to satisfy the request.'
    );
  },
});
