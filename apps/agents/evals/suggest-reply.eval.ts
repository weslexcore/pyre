// Suggester: a reply on the note counts as much as the note. The note asks a
// question with no number in it; an admin's reply answers it with how many
// are left. That is a count on the matching item, credited to the reply (its
// replyId), and no count is read out of the question itself.

import { defineEval } from 'eve/evals';
import { satisfies } from 'eve/evals/expect';
import { getDb } from '../agent/lib/db';
import {
  asSaved,
  lastSaved,
  OPENING_MESSAGE,
  suggesterHeaders,
  withInventoryItem,
  withShiftNote,
} from './lib/suggest';

export default defineEval({
  description: "Reads a count out of an admin's reply to the note, credited to the reply",
  async test(t) {
    await withInventoryItem({ name: 'Eval eucalyptus oil', inStock: 6, reorderAt: 2 }, (itemId) =>
      withShiftNote(
        'Eucalyptus oil is getting low. Should I count it before I leave?',
        '2026-09-24',
        async (noteId) => {
          const { data, error } = await getDb()
            .from('shift_note_replies')
            .insert({
              note_id: noteId,
              body: 'I just checked: we have 2 bottles of eval eucalyptus oil left.',
              author_email: 'suggester-eval-admin@pyresauna.test',
            })
            .select('id')
            .single();
          if (error) throw new Error(`fixture reply: ${error.message}`);
          const replyId = (data as { id: string }).id;

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
          t.check(
            counts,
            satisfies((c) => asSaved(c).length === 1, 'exactly one inventory count')
          );
          t.check(
            counts[0],
            satisfies((s) => {
              const saved = s as
                | { replyId?: string; payload?: { itemId?: string; inStock?: number } }
                | undefined;
              return (
                saved?.payload?.itemId === itemId &&
                saved.payload.inStock === 2 &&
                saved.replyId === replyId
              );
            }, 'a count of 2 on the oil, credited to the reply')
          );
        }
      )
    );
  },
});
