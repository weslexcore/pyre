// Per-session system prompt: the scheduler's or the knowledge assistant's,
// chosen from the session's auth attributes (see lib/role.ts). Resolved at
// session start and re-checked each turn; the initiator decides, so a
// follow-up can never switch a conversation to the other role.

import { defineDynamic, defineInstructions } from 'eve/instructions';
import { KNOWLEDGE_INSTRUCTIONS } from '../lib/prompts/knowledge';
import { SCHEDULER_INSTRUCTIONS } from '../lib/prompts/scheduler';
import { resolveRole } from '../lib/role';

function instructionsFor(auth: Parameters<typeof resolveRole>[0]) {
  const { role } = resolveRole(auth);
  return defineInstructions({
    markdown: role === 'knowledge' ? KNOWLEDGE_INSTRUCTIONS : SCHEDULER_INSTRUCTIONS,
  });
}

export default defineDynamic({
  events: {
    'session.started': (_event, ctx) => instructionsFor(ctx.session.auth),
    'turn.started': (_event, ctx) => instructionsFor(ctx.session.auth),
  },
});
