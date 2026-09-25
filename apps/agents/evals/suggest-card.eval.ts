// Suggester: a note with one clear piece of new work becomes one card on a
// board, with the due date the note implies and no assignee.

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
  description: 'Turns a note with new work into one card, due when the note says',
  async test(t) {
    await withShiftNote(
      'Left cold tub filter is clogged again and the water is getting cloudy. Needs a new ' +
        'filter before the private event on Saturday 9/27.',
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

        turn.toolOrder(['get_suggestion_context', 'search_open_cards', 'save_suggestions']);
        turn.notCalledTool('save_proposal');
        turn.expectOk();
        t.maxToolCalls(10);

        const saved = lastSaved(turn);
        t.check(
          saved,
          satisfies((s) => asSaved(s).length === 1, 'exactly one suggestion')
        );
        const card = saved[0];
        t.check(
          card?.kind,
          satisfies((k) => k === 'board_card.create', 'a new card')
        );
        t.check(
          card?.payload.dueDate,
          satisfies((d) => typeof d === 'string' && d <= '2026-09-27', 'due by Saturday 9/27')
        );
        t.check(
          card?.payload,
          satisfies((p) => !('ownerEmail' in ((p ?? {}) as object)), 'assigns nobody')
        );
        t.judge(
          'The suggested card title is a short imperative task about replacing the left cold ' +
            'tub filter, and its notes mention the cloudy water and the Saturday event.',
          { on: JSON.stringify(card ?? {}) }
        ).atLeast(0.7);
      }
    );
  },
});
