import { defineAgent, defineDynamic } from 'eve';
import { resolveRole } from './lib/role';

// Model strings route through Vercel AI Gateway (OIDC on Vercel; local dev
// needs AI_GATEWAY_API_KEY).
//
// The roles want different models. The scheduler is judgment over a
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
//
// The classifier reads one short note and makes one tool call, and runs on
// every note written, so it stays on Sonnet at low effort: the categories
// are defined in the prompt and need care, not deliberation.
const SCHEDULER_MODEL = 'anthropic/claude-sonnet-5';
const KNOWLEDGE_MODEL = 'anthropic/claude-opus-5';
const CLASSIFIER_MODEL = 'anthropic/claude-sonnet-5';

export default defineAgent({
  model: defineDynamic({
    fallback: SCHEDULER_MODEL,
    events: {
      'session.started': (_event, ctx) => {
        const { role } = resolveRole(ctx.session.auth);
        if (role === 'knowledge') {
          return {
            model: KNOWLEDGE_MODEL,
            modelOptions: { providerOptions: { anthropic: { effort: 'low' } } },
          };
        }
        if (role === 'classifier') {
          return {
            model: CLASSIFIER_MODEL,
            modelOptions: { providerOptions: { anthropic: { effort: 'low' } } },
          };
        }
        return null;
      },
    },
  }),
});
