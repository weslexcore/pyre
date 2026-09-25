// Agent-facing suggestion writer: the pyre-agents suggester posts what it
// thinks should happen next for one source record (a shift note) — new
// cards, comments on existing cards, SOP edits — and this route checks each
// against the live data with the same code an admin's approval runs
// (lib/suggestions), stores them as pending for review, closes the run, and
// tells the admins. Nothing here applies anything: that takes an admin.
//
//   POST { runId, agentSessionId?, dryRun?, suggestions: [{ kind, rationale,
//          confidence?, payload }] }
//     → 200 { saved, count }            (an empty list closes the run with none)
//     → 200 { dryRun: true, suggestions } (validated, nothing written)
//     → 4xx { error, index? }           (index names the suggestion to fix)
//
// Auth: Bearer AGENT_API_SECRET (server-to-server; never cookies). The run —
// and through it the source record — comes from the session's auth on the
// agent side, not from the model.

import type { APIRoute } from 'astro';
import { agentUnauthorizedResponse, isAgentAuthorized } from '@/lib/agent/auth';
import { getDb } from '@/lib/db';
import { intakeSuggestions } from '@/lib/suggestions/intake';
import { notifySuggestionsReady } from '@/lib/suggestions/notify';
import { loadRun } from '@/lib/suggestions/runs';
import { SUGGESTION_SOURCES } from '@/lib/suggestions/sources';
import { insertSuggestions } from '@/lib/suggestions/store';
import { isUuid } from '@/lib/suggestions/types';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

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

  const dryRun = body.dryRun === true;
  const run = isUuid(body.runId) ? await loadRun(db, body.runId) : null;
  if (!dryRun) {
    if (!run) return json({ error: 'runId must name an open suggestion run' }, 400);
    if (run.status === 'done') {
      return json({ error: 'This run already saved its suggestions; each run saves once' }, 409);
    }
    if (run.status === 'failed') return json({ error: 'This run was abandoned' }, 409);
  }

  const intake = await intakeSuggestions(db, body.suggestions);
  if (!intake.ok) {
    return json(
      { error: intake.error, ...(intake.index !== undefined ? { index: intake.index } : {}) },
      intake.status
    );
  }
  if (dryRun || !run) return json({ dryRun: true, suggestions: intake.suggestions });

  const agentSessionId =
    typeof body.agentSessionId === 'string' ? body.agentSessionId : run.agent_session_id;
  const saved = await insertSuggestions(db, run, intake.suggestions, agentSessionId);
  if ('error' in saved) return json({ error: saved.error }, 500);

  const source = await SUGGESTION_SOURCES[run.source_type].load(db, run.source_id);
  if (source) await notifySuggestionsReady(db, source, saved.rows);

  return json({ saved: true, count: saved.rows.length });
};
