// Knowledge assistant: a staff question is answered from the SOP library
// with links back to the dashboard. Runs against `eve dev` with SUPABASE_URL
// / SUPABASE_AGENTS_SECRET_KEY pointed at a database carrying the seeded
// SOPs and the knowledge_search migration. The session is opened by hand
// (rather than t.send) so the request can carry the role header the
// integrations app sends; the eval then attaches to the session it started.

import { defineEval } from 'eve/evals';
import { includes, satisfies } from 'eve/evals/expect';

const KNOWLEDGE_HEADERS = {
  'content-type': 'application/json',
  'x-pyre-agent': 'knowledge',
  'x-pyre-knowledge-scope': JSON.stringify({
    role: 'staff',
    email: '',
    shiftNotes: null,
    incidents: null,
    water: false,
  }),
};

export default defineEval({
  description: 'Answers "benefits of cold plunging" from the health guide with dashboard links',
  async test(t) {
    const response = await t.target.fetch('/eve/v1/session', {
      method: 'POST',
      headers: KNOWLEDGE_HEADERS,
      body: JSON.stringify({
        message:
          'A staff member asks: What are the benefits of cold plunging?\n' +
          '<staff-question>\nWhat are the benefits of cold plunging?\n</staff-question>',
      }),
    });
    const sessionId = response.headers.get('x-eve-session-id');
    await t.require(
      sessionId,
      satisfies((v) => typeof v === 'string' && v.length > 0, 'x-eve-session-id header present')
    );

    const turn = await t.target.watchTurn(sessionId as string).result();

    turn.calledTool('search_knowledge_base');
    turn.noFailedActions();
    turn.expectOk();
    t.maxToolCalls(8);

    const reply = turn.message ?? '';
    t.check(reply, includes('/admin/sops/'));
    t.check(
      reply,
      satisfies((v) => !/save_proposal|get_week_context/.test(String(v)), 'never names scheduler tools')
    );

    t.judge.autoevals.closedQA(
      'The reply answers from the sauna and cold plunge health guide: it lists benefits with the ' +
        "guide's evidence qualifiers (strong / moderate / early) or equivalent caution, does not " +
        'invent claims beyond what a knowledge base would hold, and ends with a Sources list ' +
        'linking to /admin/sops/ pages.'
    );
  },
});
