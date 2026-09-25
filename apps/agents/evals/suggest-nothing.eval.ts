// Suggester: a report of work already done calls for nothing, and the agent
// still closes the run with an empty save.

import { defineEval } from 'eve/evals';
import { satisfies } from 'eve/evals/expect';
import {
  asSaved,
  lastSaved,
  OPENING_MESSAGE,
  suggesterHeaders,
  withShiftNote,
} from './lib/suggest';

export default defineEval({
  description: 'Saves an empty list for a note with nothing outstanding',
  async test(t) {
    await withShiftNote(
      'Restocked towels and eucalyptus, shocked the right tub, all closing duties done. ' +
        'Quiet night, guests were happy.',
      '2026-09-24',
      async (noteId) => {
        const response = await t.target.fetch('/eve/v1/session', {
          method: 'POST',
          headers: suggesterHeaders(noteId),
          body: JSON.stringify({ message: OPENING_MESSAGE }),
        });
        const sessionId = response.headers.get('x-eve-session-id');
        await t.require(
          sessionId,
          satisfies((v) => typeof v === 'string', 'session started')
        );
        const turn = await t.target.watchTurn(sessionId as string).result();

        turn.calledTool('save_suggestions');
        turn.expectOk();
        t.check(
          lastSaved(turn),
          satisfies((s) => asSaved(s).length === 0, 'suggests nothing')
        );
      }
    );
  },
});
