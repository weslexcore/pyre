// Suggester: "52 towels used" takes 52 off the stock on record — towels go
// out to a laundry service, so the number used is fewer ready for guests —
// even under a "Towel count" heading, which does not make 52 the number on
// hand. Files no task, since the note asks for nothing.

import { defineEval } from 'eve/evals';
import { satisfies } from 'eve/evals/expect';
import {
  asSaved,
  lastSaved,
  OPENING_MESSAGE,
  suggesterHeaders,
  withInventoryItem,
  withShiftNote,
} from './lib/suggest';

export default defineEval({
  description: 'Turns "N of X used" into a count of the stock on record minus N',
  async test(t) {
    await withInventoryItem({ name: 'Eval bath towels', inStock: 145, reorderAt: 100 }, (itemId) =>
      withShiftNote('Towel count - 52 eval bath towels used', '2026-09-24', async (noteId) => {
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

        turn.calledTool('get_suggestion_context');
        turn.notCalledTool('save_proposal');
        turn.expectOk();
        t.maxToolCalls(10);

        const saved = lastSaved(turn);
        const counts = asSaved(saved).filter((s) => s.kind === 'inventory.count');
        t.check(
          counts,
          satisfies((c) => asSaved(c).length === 1, 'exactly one inventory count')
        );
        t.check(
          counts[0]?.payload,
          satisfies(
            (p) =>
              (p as { itemId?: string; inStock?: number } | undefined)?.itemId === itemId &&
              (p as { inStock?: number } | undefined)?.inStock === 93,
            'counts 145 - 52 = 93 on the towels item'
          )
        );
        t.check(
          saved,
          satisfies(
            (s) => !asSaved(s).some((x) => x.kind === 'board_card.create'),
            'files no task about the count'
          )
        );
      })
    );
  },
});
