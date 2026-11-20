// Suggester: every item moves the way the note reads. "2 in stock" with 2 on
// record is still a count (a set of 2, which stamps when it was last
// counted), and "got 1 box of cups in" is a change of +1 on the cups.

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

type CountPayload = { itemId?: string; inStock?: number; change?: number } | undefined;

export default defineEval({
  description: 'Sets an unchanged count and adds a number received',
  async test(t) {
    await withInventoryItem({ name: 'Eval hand towels', inStock: 2 }, (towelsId) =>
      withInventoryItem({ name: 'Eval paper cups', inStock: 2 }, (cupsId) =>
        withShiftNote(
          'End of night: 2 eval hand towels in stock. Got 1 box of eval paper cups in.',
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

            turn.calledTool('get_suggestion_context');
            turn.expectOk();
            t.maxToolCalls(10);

            const counts = asSaved(lastSaved(turn)).filter((s) => s.kind === 'inventory.count');
            const on = (id: string) =>
              counts.find((c) => (c.payload as CountPayload)?.itemId === id)?.payload as CountPayload;
            t.check(
              on(towelsId),
              satisfies(
                (p) => (p as CountPayload)?.inStock === 2 && (p as CountPayload)?.change === undefined,
                'sets 2 on the towels, though it matches the record'
              )
            );
            t.check(
              on(cupsId),
              satisfies(
                (p) => (p as CountPayload)?.change === 1 && (p as CountPayload)?.inStock === undefined,
                'a change of +1 on the cups'
              )
            );
          }
        )
      )
    );
  },
});
