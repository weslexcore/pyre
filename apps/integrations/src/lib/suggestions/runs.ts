// Suggestion runs: one pass of the suggester agent over one source record.
// A run is filed before the agent starts and closed by the agent posting its
// suggestions (./store insertSuggestions), since the integrations app never
// sees an Eve session end. A run left open too long reads as failed. Server-only.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentSuggestionRunRow } from '@/lib/db';
import type { SourceRecord } from './sources';

/** A run still queued or running after this long is treated as failed. */
export const RUN_STALE_MS = 15 * 60 * 1000;

export function isStale(
  run: Pick<AgentSuggestionRunRow, 'status' | 'created_at'>,
  now = Date.now()
): boolean {
  return (
    (run.status === 'queued' || run.status === 'running') &&
    now - Date.parse(run.created_at) > RUN_STALE_MS
  );
}

/** How the review UI shows a run: its status, with stale open runs as failed. */
export function runState(
  run: Pick<AgentSuggestionRunRow, 'status' | 'created_at'>,
  now = Date.now()
): AgentSuggestionRunRow['status'] {
  return isStale(run, now) ? 'failed' : run.status;
}

/**
 * File the automatic run for this version of the record's text. Null when one
 * already exists (a redelivered job, or text already looked at) — the unique
 * index on (source, hash) for auto runs is what makes "once per version" hold.
 */
export async function claimAutoRun(
  db: SupabaseClient,
  source: SourceRecord
): Promise<AgentSuggestionRunRow | null> {
  const { data, error } = await db
    .from('agent_suggestion_runs')
    .insert({
      source_type: source.type,
      source_id: source.id,
      source_hash: source.hash,
      trigger: 'auto',
    })
    .select('*')
    .single();
  if (error) {
    if (error.code !== '23505')
      console.error('[suggestions] could not file auto run:', error.message);
    return null;
  }
  return data as AgentSuggestionRunRow;
}

/** File an admin's run; always allowed. */
export async function createManualRun(
  db: SupabaseClient,
  source: SourceRecord,
  requestedBy: string
): Promise<{ ok: true; run: AgentSuggestionRunRow } | { ok: false; error: string }> {
  const { data, error } = await db
    .from('agent_suggestion_runs')
    .insert({
      source_type: source.type,
      source_id: source.id,
      source_hash: source.hash,
      trigger: 'manual',
      requested_by: requestedBy,
    })
    .select('*')
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, run: data as AgentSuggestionRunRow };
}

export async function loadRun(
  db: SupabaseClient,
  id: string
): Promise<AgentSuggestionRunRow | null> {
  const { data } = await db.from('agent_suggestion_runs').select('*').eq('id', id).maybeSingle();
  return (data as AgentSuggestionRunRow) ?? null;
}

export async function markRunning(
  db: SupabaseClient,
  runId: string,
  sessionId: string | null
): Promise<void> {
  const { error } = await db
    .from('agent_suggestion_runs')
    .update({
      status: 'running',
      agent_session_id: sessionId,
      started_at: new Date().toISOString(),
    })
    .eq('id', runId)
    .eq('status', 'queued');
  if (error) console.error('[suggestions] could not mark run running:', error.message);
}

export async function markDone(db: SupabaseClient, runId: string, count: number): Promise<void> {
  const { error } = await db
    .from('agent_suggestion_runs')
    .update({
      status: 'done',
      suggestion_count: count,
      error: null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', runId);
  if (error) console.error('[suggestions] could not close run:', error.message);
}

export async function markFailed(
  db: SupabaseClient,
  runId: string,
  message: string
): Promise<void> {
  const { error } = await db
    .from('agent_suggestion_runs')
    .update({
      status: 'failed',
      error: message.slice(0, 1000),
      finished_at: new Date().toISOString(),
    })
    .eq('id', runId)
    .in('status', ['queued', 'running']);
  if (error) console.error('[suggestions] could not fail run:', error.message);
}

/** The latest run per source record, keyed by source id. */
export async function latestRuns(
  db: SupabaseClient,
  sourceType: string,
  ids: readonly string[]
): Promise<Map<string, AgentSuggestionRunRow>> {
  const out = new Map<string, AgentSuggestionRunRow>();
  if (ids.length === 0) return out;
  const { data, error } = await db
    .from('agent_suggestion_runs')
    .select('*')
    .eq('source_type', sourceType)
    .in('source_id', [...ids])
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[suggestions] run read failed:', error.message);
    return out;
  }
  for (const run of (data ?? []) as AgentSuggestionRunRow[]) {
    if (!out.has(run.source_id)) out.set(run.source_id, run);
  }
  return out;
}
