// One suggestion job, run: file (or pick up) the run, then start the agent on
// it. The QStash worker (/api/suggest/run) calls this, and so does the inline
// fallback where QStash is not configured. Server-only.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentSuggestionRunRow } from '@/lib/db';
import { autoSuggestCheck } from './eligibility';
import { claimAutoRun, loadRun, markFailed, markRunning } from './runs';
import { startSuggesterSession } from './session';
import { SUGGESTION_SOURCES } from './sources';
import type { SuggestionSourceType } from './types';

/** The message body the worker reads. */
export interface SuggestJob {
  sourceType: SuggestionSourceType;
  sourceId: string;
  trigger: 'auto' | 'manual';
  /** A manual run, filed by the admin route before the job was queued. */
  runId?: string;
}

export type SuggestJobOutcome =
  | { state: 'started'; runId: string; sessionId: string | null }
  | { state: 'skipped'; reason: string }
  /** Starting the agent failed; worth retrying. */
  | { state: 'failed'; error: string };

/** An auto run for this text that was filed but never got its agent started. */
async function unstartedAutoRun(
  db: SupabaseClient,
  sourceType: SuggestionSourceType,
  sourceId: string,
  hash: string
): Promise<AgentSuggestionRunRow | null> {
  const { data } = await db
    .from('agent_suggestion_runs')
    .select('*')
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .eq('source_hash', hash)
    .eq('trigger', 'auto')
    .eq('status', 'queued')
    .maybeSingle();
  return (data as AgentSuggestionRunRow) ?? null;
}

export async function runSuggestJob(
  db: SupabaseClient,
  job: SuggestJob,
  options: { retried?: boolean; finalAttempt?: boolean } = {}
): Promise<SuggestJobOutcome> {
  const source = await SUGGESTION_SOURCES[job.sourceType].load(db, job.sourceId);
  if (!source) {
    if (job.runId) await markFailed(db, job.runId, 'The record was deleted');
    return { state: 'skipped', reason: 'source deleted' };
  }

  let run: AgentSuggestionRunRow | null;
  if (job.trigger === 'manual') {
    if (!job.runId) return { state: 'skipped', reason: 'manual job without a run' };
    run = await loadRun(db, job.runId);
    if (run?.status !== 'queued') return { state: 'skipped', reason: 'run already handled' };
  } else {
    // Re-checked here, not only when the job was queued: the note may have
    // been resolved or dismissed in between.
    const { data } = await db
      .from('content_classifications')
      .select('signals')
      .eq('subject_type', job.sourceType)
      .eq('subject_id', job.sourceId)
      .maybeSingle();
    const check = await autoSuggestCheck(
      db,
      job.sourceType,
      job.sourceId,
      (data as { signals: unknown } | null)?.signals
    );
    run = check.ok
      ? await claimAutoRun(db, source)
      : options.retried
        ? await unstartedAutoRun(db, job.sourceType, job.sourceId, source.hash)
        : null;
    if (!run) return { state: 'skipped', reason: 'not eligible, or already looked at' };
  }

  try {
    const sessionId = await startSuggesterSession(run);
    await markRunning(db, run.id, sessionId);
    return { state: 'started', runId: run.id, sessionId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[suggestions] could not start the agent for run ${run.id}:`, message);
    if (options.finalAttempt) await markFailed(db, run.id, message);
    return { state: 'failed', error: message };
  }
}
