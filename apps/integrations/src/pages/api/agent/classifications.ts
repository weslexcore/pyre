// Agent-facing classification writer: a pyre-agents classifier session saves
// what it found in one record's text. The session names only its request id
// (stamped on the session by the integrations app that started it — the
// model never chooses it), and the row that request belongs to decides the
// subject, so a session can only ever write its own result. Signals are
// validated against the shared registry (@pyre/signals-core) for that
// subject.
//
//   POST { requestId, signals, agentSessionId? } → { ok, signals }
//     400 invalid payload (the agent fixes and retries)
//     409 superseded: the record changed or was deleted since the request
//
// Auth: Bearer AGENT_API_SECRET (server-to-server; never cookies).

import { isSubjectType, parseSignals } from '@pyre/signals-core';
import type { APIRoute } from 'astro';
import { agentUnauthorizedResponse, isAgentAuthorized } from '@/lib/agent/auth';
import { type ContentClassificationRow, getDb } from '@/lib/db';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const requestId = typeof body.requestId === 'string' ? body.requestId.toLowerCase() : '';
  if (!UUID_RE.test(requestId)) return json({ error: 'requestId must be a UUID' }, 400);

  const { data, error } = await db
    .from('content_classifications')
    .select('id, subject_type, status')
    .eq('request_id', requestId)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  const row = data as Pick<ContentClassificationRow, 'id' | 'subject_type' | 'status'> | null;
  if (!row) {
    return json({ error: 'Superseded: this request is no longer current' }, 409);
  }
  if (!isSubjectType(row.subject_type)) {
    return json({ error: `Unknown subject type ${row.subject_type}` }, 409);
  }

  const parsed = parseSignals(body.signals, row.subject_type);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const agentSessionId =
    typeof body.agentSessionId === 'string' ? body.agentSessionId.slice(0, 200) : null;

  // Guarded on the request id again: a re-request between the read above
  // and this write rotates it, and then this save is the stale one.
  const { data: saved, error: saveError } = await db
    .from('content_classifications')
    .update({
      status: 'done',
      signals: parsed.signals,
      error: null,
      classified_at: new Date().toISOString(),
      ...(agentSessionId ? { agent_session_id: agentSessionId } : {}),
    })
    .eq('id', row.id)
    .eq('request_id', requestId)
    .select('id')
    .maybeSingle();
  if (saveError) return json({ error: saveError.message }, 500);
  if (!saved) return json({ error: 'Superseded: this request is no longer current' }, 409);

  return json({ ok: true, signals: parsed.signals });
};
