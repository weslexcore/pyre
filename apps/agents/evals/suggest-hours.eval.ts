// Suggester: "Sam and I stayed until 8:30p" re-times both people's
// assignments on that evening's shift — the hours the timesheet pays — and
// files no task about it.

import { defineEval } from 'eve/evals';
import { satisfies } from 'eve/evals/expect';
import {
  asSaved,
  lastSaved,
  OPENING_MESSAGE,
  suggesterHeaders,
  withCrewedShift,
  withShiftNote,
} from './lib/suggest';

export default defineEval({
  description: 'Turns "X and I stayed late" into new end times on both assignments',
  async test(t) {
    await withCrewedShift(
      {
        date: '2026-09-24',
        other: 'Sam Evalson',
        startsAt: '16:00',
        endsAt: '20:00',
      },
      (assignments) =>
        withShiftNote(
          'Sam and I stayed until 8:30p to finish the deep clean of sauna 2.',
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

            turn.calledTool('find_shift_assignments');
            turn.notCalledTool('save_proposal');
            turn.expectOk();
            t.maxToolCalls(10);

            const saved = lastSaved(turn);
            const hours = asSaved(saved).filter((s) => s.kind === 'shift_assignment.update');
            t.check(
              hours.map((s) => s.payload.assignmentId).sort(),
              satisfies(
                (ids) =>
                  JSON.stringify(ids) ===
                  JSON.stringify([assignments.author, assignments.other].sort()),
                "re-times Sam's and the author's assignments, nobody else's"
              )
            );
            t.check(
              hours,
              satisfies(
                (h) =>
                  asSaved(h).every(
                    (s) => s.payload.endsAt === '20:30' && s.payload.startsAt === undefined
                  ),
                'moves only the end, to 20:30'
              )
            );
            t.check(
              saved,
              satisfies(
                (s) => !asSaved(s).some((x) => x.kind === 'board_card.create'),
                'files no task about the hours'
              )
            );
          }
        )
    );
  },
});
