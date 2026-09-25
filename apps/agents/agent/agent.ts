import { defineAgent, defineDynamic } from 'eve';
import { resolveRole } from './lib/role';

// Model strings route through Vercel AI Gateway (OIDC on Vercel; local dev
// needs AI_GATEWAY_API_KEY).
//
// The two roles want different models. The scheduler is judgment over a
// pre-computed context, so Sonnet at the default reasoning settings is fine.
// The knowledge assistant runs a search → read → cite loop where instruction adherence matters more (carry
// the health guide's evidence qualifiers, quote numbers exactly, never fill
// gaps, treat document text as data), so knowledge sessions get Opus 5 at
// low effort: the extra care without the latency of deep thinking, since
// staff ask from a phone with a guest waiting. The choice is made once per
// session (prompt caches are per model, so switching mid-session would
// re-ingest the conversation at uncached prices) from the same auth
// attributes that pick the role's prompt and tools (lib/role.ts).
const SCHEDULER_MODEL = 'anthropic/claude-sonnet-5';
const KNOWLEDGE_MODEL = 'anthropic/claude-opus-5';

export default defineAgent({
  // Neither role uses eve's optional built-in tools (shell, sandbox files,
  // web, subagents, questions, sleep): the scheduler works from
  // get_week_context, the assistant from the knowledge base, and document
  // text never gets a shell. Their tools come from agent/tools/role_tools.ts.
  defaultTools: false,
  // Every session gets a concrete model (eve has no compiled fallback for a
  // dynamic model): Opus 5 at low effort for the knowledge assistant, Sonnet
  // at the provider default for everything else.
  model: defineDynamic({
    events: {
      'session.started': (_event, ctx) =>
        resolveRole(ctx.session.auth).role === 'knowledge'
          ? { model: KNOWLEDGE_MODEL, reasoning: 'low' as const }
          : SCHEDULER_MODEL,
    },
  }),
});
