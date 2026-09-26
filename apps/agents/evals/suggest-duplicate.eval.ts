// Suggester: a second report of work that already has an open card becomes a
// comment on that card, not a duplicate.

import { defineEval } from 'eve/evals';
import { satisfies } from 'eve/evals/expect';
import {
  asSaved,
  lastSaved,
  OPENING_MESSAGE,
  suggesterHeaders,
  withOpenCard,
  withShiftNote,
} from './lib/suggest';

export default defineEval({
  description: 'Comments on the open card that already covers the work',
  async test(t) {
    await withOpenCard(
      'Fix sauna 2 heater cycling off',
      'Heater in sauna 2 cuts out mid-session. Electrician to look.',
      (cardId) =>
        withShiftNote(
          'Sauna 2 heater cut out twice tonight during the 7pm session, guests noticed. ' +
            'Had to restart it from the panel both times.',
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

            turn.calledTool('search_open_cards');
            turn.expectOk();

            const saved = lastSaved(turn);
            t.check(
              saved,
              satisfies(
                (s) =>
                  asSaved(s).some(
                    (x) => x.kind === 'board_card.comment' && x.payload.cardId === cardId
                  ),
                'comments on the existing card'
              )
            );
            t.check(
              saved,
              satisfies(
                (s) => !asSaved(s).some((x) => x.kind === 'board_card.create'),
                'does not open a duplicate card'
              )
            );
          }
        )
    );
  },
});
