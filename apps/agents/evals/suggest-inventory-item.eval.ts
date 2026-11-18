// Suggester: a note about a supply the inventory doesn't track yet becomes an
// inventory.create for it — nothing like it on the inventory list — and
// never a count on some other item, nor a task.

import { defineEval } from 'eve/evals';
import { satisfies } from 'eve/evals/expect';
import { asSaved, lastSaved, OPENING_MESSAGE, suggesterHeaders, withShiftNote } from './lib/suggest';

export default defineEval({
  description: 'Suggests adding a supply the inventory does not track yet',
  async test(t) {
    await withShiftNote(
      'We started keeping a box of eval foam earplugs at the front desk for guests. About 40 left in it.',
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
        t.maxToolCalls(12);

        const saved = asSaved(lastSaved(turn));
        const created = saved.filter((s) => s.kind === 'inventory.create');
        t.check(
          created,
          satisfies((c) => asSaved(c).length === 1, 'exactly one new inventory item')
        );
        t.check(
          created[0]?.payload,
          satisfies((p) => {
            const item = p as { name?: string; inStock?: number } | undefined;
            return /earplug/i.test(item?.name ?? '') && item?.inStock === 40;
          }, 'names the earplugs, with 40 on hand')
        );
        t.check(
          saved,
          satisfies((s) => !asSaved(s).some((x) => x.kind === 'inventory.count'), 'counts nothing else')
        );
      }
    );
  },
});
