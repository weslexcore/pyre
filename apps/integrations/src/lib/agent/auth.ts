// Auth for the /api/agent/* server-to-server routes called by the pyre-agents
// Eve app (same shape as lib/cron/auth.ts): `Authorization: Bearer
// ${AGENT_API_SECRET}`. These routes are never cookie-authed and never called
// from a browser.

export function isAgentAuthorized(request: Request): boolean {
  const secret = import.meta.env.AGENT_API_SECRET;
  if (!secret) {
    console.error('[Agent] AGENT_API_SECRET not configured — rejecting all agent requests');
    return false;
  }
  return request.headers.get('Authorization') === `Bearer ${secret}`;
}

export function agentUnauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
