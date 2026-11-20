// Agent-facing suggestion writer: the pyre-agents suggester posts what it
// thinks should happen next for one source record (a shift note) — new
// cards, comments on existing cards, SOP edits, new hours, inventory counts
// and new inventory items
// — and this route checks each
// against the live data with the same code an admin's approval runs
// (lib/suggestions), stores them as pending for review, closes the run, and
// tells the admins. Nothing here applies anything: that takes an admin.
//
//   POST { runId, agentSessionId?, dryRun?, suggestions: [{ kind, rationale,
//          confidence?, replyId?, payload }] }
//     replyId: on an inventory count or new item read out of a reply in the
//     note's thread rather than the note, that reply — the count is then
//     credited to the reply's author at the reply's time.
//     → 200 { saved, count }            (an empty list closes the run with none)
//     → 200 { dryRun: true, suggestions } (validated, nothing written)
//     → 4xx { error, index? }           (index names the suggestion to fix)
//   POST { runId, ended: true, error? } → 200 { run: status }
//     The agent's turn ended. A run that saved is left alone; one still open
//     is failed on the spot (with the turn's error, if it had one), so the
//     page stops showing "Looking…" instead of waiting for it to go stale.
//
// Auth: Bearer AGENT_API_SECRET (server-to-server; never cookies). The run —
// and through it the source record — comes from the session's auth on the
// agent side, not from the model.

import type { APIRoute } from 'astro';
import { agentUnauthorizedResponse, isAgentAuthorized } from '@/lib/agent/auth';
import { getDb } from '@/lib/db';
import { json } from '@/lib/http/route';
import { type CountCredit, intakeSuggestions } from '@/lib/suggestions/intake';
import { notifySuggestionsReady } from '@/lib/suggestions/notify';
import { loadRun, markFailed } from '@/lib/suggestions/runs';
import { SUGGESTION_SOURCES } from '@/lib/suggestions/sources';
import { insertSuggestions } from '@/lib/suggestions/store';
import { isUuid } from '@/lib/suggestions/types';

export const prerender = false;

type Db = NonNullable<ReturnType<typeof getDb>>;

/**
 * Who each suggestion's count is credited to, by index, when the agent says
 * it read the number out of a reply: that reply's author, at its time. The
 * reply must be a comment on the run's own note; anything else names the
 * suggestion to fix.
 */
async function replyCredits(
  db: Db,
  noteId: string | null,
  raw: unknown
): Promise<
  { ok: true; credits: (CountCredit | undefined)[] } | { ok: false; error: string; index: number }
> {
  const entries = Array.isArray(raw) ? raw : [];
  const wanted = entries.map((entry) => {
    const replyId =
      entry && typeof entry === 'object' ? (entry as { replyId?: unknown }).replyId : undefined;
    return replyId === undefined || replyId === null ? null : replyId;
  });
  // A dry run has no note to look replies up on; the note's author stands.
  if (!noteId || wanted.every((id) => id === null)) return { ok: true, credits: [] };

  const ids = [
    ...new Set(wanted.filter((id): id is string => isUuid(id)).map((id) => id.toLowerCase())),
  ];
  const { data } =
    ids.length > 0
      ? await db
          .from('shift_note_replies')
          .select('id, author_email, created_at')
          .eq('note_id', noteId)
          .eq('kind', 'comment')
          .in('id', ids)
      : { data: [] };
  const replies = new Map(
    ((data ?? []) as { id: string; author_email: string | null; created_at: string }[]).map((r) => [
      r.id,
      r,
    ])
  );

  const credits: (CountCredit | undefined)[] = [];
  for (const [index, id] of wanted.entries()) {
    if (id === null) {
      credits.push(undefined);
      continue;
    }
    const reply = typeof id === 'string' ? replies.get(id.toLowerCase()) : undefined;
    if (!reply) {
      return {
        ok: false,
        error: 'replyId must name a reply in note.replies from get_suggestion_context',
        index,
      };
    }
    credits.push({
      author: reply.author_email?.trim().toLowerCase() || null,
      recordedAt: reply.created_at,
    });
  }
  return { ok: true, credits };
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

  if (body.ended === true) {
    if (!run) return json({ error: 'runId must name a suggestion run' }, 400);
    if (run.status === 'queued' || run.status === 'running') {
      const reason =
        typeof body.error === 'string' && body.error.trim()
          ? `The agent stopped: ${body.error.trim()}`
          : 'The agent finished without saving any suggestions';
      console.warn(`[suggestions] run ${run.id} ended unsaved: ${reason}`);
      await markFailed(db, run.id, reason);
      return json({ run: 'failed' });
    }
    return json({ run: run.status });
  }
  if (!dryRun) {
    if (!run) return json({ error: 'runId must name an open suggestion run' }, 400);
    if (run.status === 'done') {
      return json({ error: 'This run already saved its suggestions; each run saves once' }, 409);
    }
    if (run.status === 'failed') return json({ error: 'This run was abandoned' }, 409);
  }

  // The record the run is about, read before intake: a count read out of it
  // is credited to its author.
  const source = run
    ? await SUGGESTION_SOURCES[run.source_type].load(db, run.source_id).catch(() => null)
    : null;
  // A count read out of a reply instead is credited to the reply's author.
  const credited = await replyCredits(
    db,
    run?.source_type === 'shift_note' ? run.source_id : null,
    body.suggestions
  );
  if (!credited.ok) return json({ error: credited.error, index: credited.index }, 422);
  const intake = await intakeSuggestions(
    db,
    body.suggestions,
    source ?? undefined,
    credited.credits
  );
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

  if (source) await notifySuggestionsReady(db, source, saved.rows);

  return json({ saved: true, count: saved.rows.length });
};
