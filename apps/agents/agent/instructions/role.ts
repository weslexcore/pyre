// Per-session system prompt: the scheduler's or the knowledge assistant's,
// chosen from the session's auth attributes (see lib/role.ts). Resolved at
// session start and re-checked each turn; the initiator decides, so a
// follow-up can never switch a conversation to the other role.

import { utcToEastern } from '@pyre/schedule-core';
import { defineDynamic, defineInstructions } from 'eve/instructions';
import { knowledgeInstructionsFor } from '../lib/prompts/knowledge';
import { SCHEDULER_INSTRUCTIONS } from '../lib/prompts/scheduler';
import { resolveRole } from '../lib/role';

function instructionsFor(auth: Parameters<typeof resolveRole>[0]) {
  const { role } = resolveRole(auth);
  // The knowledge prompt carries today's date (Eastern) for schedule
  // questions; it is re-resolved each turn, so a conversation that crosses
  // midnight picks up the new day.
  return defineInstructions({
    markdown:
      role === 'knowledge'
        ? knowledgeInstructionsFor(utcToEastern(new Date().toISOString()).date)
        : SCHEDULER_INSTRUCTIONS,
  });
}

export default defineDynamic({
  events: {
    'session.started': (_event, ctx) => instructionsFor(ctx.session.auth),
    'turn.started': (_event, ctx) => instructionsFor(ctx.session.auth),
  },
});
