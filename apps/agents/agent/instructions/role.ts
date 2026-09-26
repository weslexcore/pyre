// Per-session system prompt: the scheduler's, the knowledge assistant's, or
// the suggester's, chosen from the session's auth attributes (see lib/role.ts). Resolved at
// session start and re-checked each turn; the initiator decides, so a
// follow-up can never switch a conversation to the other role.

import { utcToEastern } from '@pyre/schedule-core';
import { defineDynamic, defineInstructions } from 'eve/instructions';
import { knowledgeInstructionsFor } from '../lib/prompts/knowledge';
import { schedulerInstructionsWith } from '../lib/prompts/scheduler';
import { suggesterInstructionsFor } from '../lib/prompts/suggester';
import { loadStandingInstructions } from '../lib/prompts/standing';
import { resolveRole } from '../lib/role';

async function instructionsFor(auth: Parameters<typeof resolveRole>[0]) {
  const { role } = resolveRole(auth);
  // The knowledge prompt carries today's date (Eastern) for schedule
  // questions; it is re-resolved each turn, so a conversation that crosses
  // midnight picks up the new day.
  if (role === 'knowledge') {
    return defineInstructions({
      markdown: knowledgeInstructionsFor(utcToEastern(new Date().toISOString()).date),
    });
  }
  // The suggester resolves relative dates in a note ("before Saturday")
  // against today, Eastern.
  if (role === 'suggester') {
    return defineInstructions({
      markdown: suggesterInstructionsFor(utcToEastern(new Date().toISOString()).date),
    });
  }
  // The scheduler's prompt carries the admin's standing instructions, read
  // fresh (behind a short cache) so an edit on the board reaches the next
  // draft — cron runs included — without a redeploy.
  const standing = await loadStandingInstructions();
  return defineInstructions({ markdown: schedulerInstructionsWith(standing) });
}

export default defineDynamic({
  events: {
    'session.started': (_event, ctx) => instructionsFor(ctx.session.auth),
    'turn.started': (_event, ctx) => instructionsFor(ctx.session.auth),
  },
});
