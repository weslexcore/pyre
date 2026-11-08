// Suggester: "three rolls of trash bags left" becomes a count of 3 on the
// trash bags item — found through find_inventory_items, never invented — and
// files no task about it, since the note asks for nothing.

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
  description: 'Turns "N of X left" into an inventory count on the matching item',
  async test(t) {
    await withInventoryItem({ name: 'Eval trash bags', inStock: 12, reorderAt: 4 }, (itemId) =>
      withShiftNote(
        'Quiet evening. Three rolls of eval trash bags left in the back closet.',
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

          turn.calledTool('find_inventory_items');
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
                (p as { inStock?: number } | undefined)?.inStock === 3,
              'counts 3 on the trash bags item'
            )
          );
          t.check(
            saved,
            satisfies(
              (s) => !asSaved(s).some((x) => x.kind === 'board_card.create'),
              'files no task about the count'
            )
          );
        }
      )
    );
  },
});
