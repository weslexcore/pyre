// Same offline setup as draft-week.eval.ts, but the drafting request carries
// the optional admin note the schedule board sends (see
// apps/integrations/src/lib/schedule/draft-prompt.ts). The note steers
// judgment only — the hard rules still bind, and the rationale has to say
// what it did with the note.

import { defineEval } from 'eve/evals';

export default defineEval({
  description: 'Drafts next week with an admin note: honours it without breaking the hard rules',
  async test(t) {
    await t.send(
      'Draft the staffing schedule for next week. ' +
        'Use get_week_context with no weekStart, then save exactly one proposal. ' +
        'Fill only shifts that are still below their staffNeeded count.\n\n' +
        'The admin added a note for this draft. Treat it as a high-priority preference for the ' +
        'judgment calls, but the hard rules in your instructions still win — never assign over ' +
        '"busy" availability, never touch covered shifts, never overfill. Open the rationale ' +
        'with a short line on how you handled the note, including anything you could not ' +
        'honour.\n<admin-note>\nGive Sarah and Omar each at least one shift to lead, and make ' +
        'sure Liz has one setup shift and one full shift.\n</admin-note>'
    );

    t.toolOrder(['get_week_context', 'save_proposal']);
    t.calledTool('save_proposal');
    t.maxToolCalls(6);
    t.noFailedActions();

    t.judge.autoevals.closedQA(
      "The assistant's rationale opens by saying how it handled the admin's note — which of the named people it placed as asked, and explicitly which parts it could not honour and why (e.g. unavailable, shift already covered). It does not claim to have broken availability or staffing limits to satisfy the note."
    );
  },
});
