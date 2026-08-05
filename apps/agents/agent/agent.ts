import { defineAgent } from 'eve';

// Model string routes through Vercel AI Gateway (OIDC on Vercel; local dev
// needs AI_GATEWAY_API_KEY). Scheduling is judgment over a pre-computed
// context, so the default reasoning settings are fine.
export default defineAgent({
  model: 'anthropic/claude-sonnet-5',
});
