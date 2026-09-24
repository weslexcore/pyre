// Server-to-server client for the integrations app's agent API (the write
// path). Bearer AGENT_API_SECRET; see apps/integrations/src/lib/agent/auth.ts.

export async function postProposal(body: Record<string, unknown>): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const baseUrl = process.env.INTEGRATIONS_BASE_URL;
  const secret = process.env.AGENT_API_SECRET;
  if (!baseUrl || !secret) {
    throw new Error('Integrations API not configured (INTEGRATIONS_BASE_URL / AGENT_API_SECRET)');
  }

  // Preview/staging deployments of pyre-integrations sit behind Vercel
  // Deployment Protection, which 401s at the edge before AGENT_API_SECRET is
  // ever checked. The bypass secret clears that layer only — the bearer above
  // is still what authenticates the write.
  const bypass = process.env.INTEGRATIONS_PROTECTION_BYPASS;

  const response = await fetch(`${baseUrl}/api/agent/proposals`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}),
    },
    body: JSON.stringify(body),
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = (await response.json()) as Record<string, unknown>;
  } catch {
    parsed = { error: `Non-JSON response (HTTP ${response.status})` };
  }

  // Deployment Protection answers with its own JSON envelope, whose `error` is
  // an object — surface it as a string so the failure reads as a deploy-config
  // problem rather than a validation one.
  if ('protection' in parsed) {
    parsed = {
      error:
        'Blocked by Vercel Deployment Protection before reaching the integrations API. ' +
        'Set INTEGRATIONS_PROTECTION_BYPASS on this deployment.',
    };
  }

  return { status: response.status, body: parsed };
}
