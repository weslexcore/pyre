// The secrets between the app and pyre-agents, shared by e2e/env.ts (which
// hands them to the app) and the mock Eve app (mock-server/eve.ts, which
// checks the channel secret and signs its calls back with the API secret).
// Kept apart from env.ts, which starts the Supabase stack on import.

/** pyre-agents' channel secret: the app's Bearer on /eve/v1/session*. */
export const EVE_CHANNEL_SECRET = 'e2e-eve-channel-secret';

/** The app's agent API secret: pyre-agents' Bearer on /api/agent/*. */
export const AGENT_API_SECRET = 'e2e-agent-api-secret';

/** Where the app finds pyre-agents: under the mock server (see mock-server/eve.ts). */
export const AGENTS_PATH = '/agents';
