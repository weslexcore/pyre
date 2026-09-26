// Auth for the /api/agent/* server-to-server routes called by the pyre-agents
// Eve app (same shape as lib/cron/auth.ts): `Authorization: Bearer
// ${AGENT_API_SECRET}`. These routes are never cookie-authed and never called
// from a browser.

import { hasBearer, unauthorized } from '@/lib/http/bearer';

export function isAgentAuthorized(request: Request): boolean {
  return hasBearer(
    request,
    import.meta.env.AGENT_API_SECRET ?? process.env.AGENT_API_SECRET,
    'Agent'
  );
}

export const agentUnauthorizedResponse = unauthorized;
