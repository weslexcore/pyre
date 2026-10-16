// pyre-agents reports a routine run's turn ending here, so the run is closed
// and its owner told the answer is ready (lib/pyre-agent/routines). The run
// id rode into the session in a header when the run started and comes back
// from the session's auth on the agent side, not from the model.
//
//   POST { runId, sessionId?, error? } → { ok, closed }
//     closed is false when the run was already settled (a repeat report, or
//     the tick's sweep got there first).
//
// Auth: Bearer AGENT_API_SECRET (server-to-server; never cookies).

import type { APIRoute } from 'astro';
import { agentUnauthorizedResponse, isAgentAuthorized } from '@/lib/agent/auth';
import { getDb } from '@/lib/db';
import { isUuid } from '@/lib/http/json';
import { json } from '@/lib/http/route';
import { finishRoutineRun } from '@/lib/pyre-agent/routines';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!isAgentAuthorized(request)) return agentUnauthorizedResponse();
  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!isUuid(body.runId)) return json({ error: 'runId must name a routine run' }, 400);

  // The run must be the one this session belongs to.
  if (typeof body.sessionId === 'string') {
    const { data } = await db
      .from('pyre_agent_routine_runs')
      .select('session_id')
      .eq('id', body.runId)
      .maybeSingle();
    const sessionId = (data as { session_id: string | null } | null)?.session_id;
    if (sessionId && sessionId !== body.sessionId) {
      return json({ error: 'That run belongs to another session' }, 409);
    }
  }

  const error = typeof body.error === 'string' && body.error.trim() ? body.error.trim() : null;
  const closed = await finishRoutineRun(
    db,
    body.runId,
    error ? { ok: false, error: `The agent stopped: ${error}` } : { ok: true }
  );
  return json({ ok: true, closed });
};
