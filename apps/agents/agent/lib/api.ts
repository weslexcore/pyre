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

  const response = await fetch(`${baseUrl}/api/agent/proposals`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = (await response.json()) as Record<string, unknown>;
  } catch {
    parsed = { error: `Non-JSON response (HTTP ${response.status})` };
  }
  return { status: response.status, body: parsed };
}
