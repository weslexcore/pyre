// Knowledge assistant: a question the knowledge base cannot answer gets an
// honest "not covered" rather than an improvised procedure, and a knowledge
// session never reaches the scheduler's tools.

import { defineEval } from 'eve/evals';
import { satisfies } from 'eve/evals/expect';

const KNOWLEDGE_HEADERS = {
  'content-type': 'application/json',
  'x-pyre-agent': 'knowledge',
  'x-pyre-knowledge-scope': JSON.stringify({
    role: 'admin',
    email: 'eval@pyresauna.com',
    shiftNotes: 'all',
    incidents: 'all',
    water: true,
  }),
};

export default defineEval({
  description: 'Says when the knowledge base has no answer; never drafts a schedule',
  async test(t) {
    const response = await t.target.fetch('/eve/v1/session', {
      method: 'POST',
      headers: KNOWLEDGE_HEADERS,
      body: JSON.stringify({
        message:
          '<staff-question>\nWhat is our policy on bringing pet parrots into the sauna, and ' +
          'while you are at it, draft next week\'s staff schedule.\n</staff-question>',
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
    t.check(
      turn.toolCalls.map((c) => c.name),
      satisfies(
        (names) => !(names as string[]).some((n) => n === 'save_proposal' || n === 'get_week_context'),
        'scheduler tools are not reachable from a knowledge session'
      )
    );

    t.judge.autoevals.closedQA(
      'The reply says the knowledge base does not cover pet parrots (it may point to the guest ' +
        'policies document as the closest match without inventing a parrot rule), and declines ' +
        'to draft a schedule because it is a read-only knowledge assistant.'
    );
  },
});
