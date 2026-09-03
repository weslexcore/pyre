import { defineAgent, defineDynamic } from 'eve';
import { resolveRole } from './lib/role';

// Model strings route through Vercel AI Gateway (OIDC on Vercel; local dev
// needs AI_GATEWAY_API_KEY).
//
// The two roles want different models. The scheduler is judgment over a
// pre-computed context, so Sonnet at the default reasoning settings is fine
// and stays the compiled fallback. The knowledge assistant runs a
// search → read → cite loop where instruction adherence matters more (carry
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
  model: defineDynamic({
    fallback: SCHEDULER_MODEL,
    events: {
      'session.started': (_event, ctx) =>
        resolveRole(ctx.session.auth).role === 'knowledge'
          ? {
              model: KNOWLEDGE_MODEL,
              modelOptions: { providerOptions: { anthropic: { effort: 'low' } } },
            }
          : null,
    },
  }),
});
