// Offline draft-week eval: run against `eve dev` with INTEGRATIONS_BASE_URL
// pointed at a local integrations dev server (local Supabase seeded by the
// staff_scheduling migrations) and AGENT_FORCE_DRY_RUN=1 so save_proposal
// validates without writing. The dry-run response carries the server-side
// conflict report, which is the ground truth the checks lean on.

import { defineEval } from 'eve/evals';

export default defineEval({
  description: 'Drafts next week: context first, one proposal save, clean conflict report',
  async test(t) {
    await t.send('Draft the staffing schedule for next week.');

    t.toolOrder(['get_week_context', 'save_proposal']);
    t.calledTool('save_proposal');
    t.maxToolCalls(6);
    t.noFailedActions();

    t.judge.autoevals.closedQA(
      'The assistant reports the draft was saved (or dry-run validated) with no hard availability conflicts, and its summary mentions any shifts left under-staffed.'
    );
  },
});
