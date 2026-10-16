// Running Pyre Agent routines: requests a person saved to run on a cadence
// (public.pyre_agent_routines). The hourly cron tick starts every routine
// that is due; "Run now" on the routines page starts one on the spot. A run
// opens a fresh Pyre Agent conversation as the routine's owner — their
// access resolved now, so a grant taken away since they saved it is gone
// from the answer too — which lands in their history like any question.
//
// The agent reports back when the run's turn ends (pyre-agents posts to
// /api/agent/routines), and the owner gets a notification linking to the
// answer. A run the agent never reports on is settled by the tick from the
// audit log once it is stale, so nothing stays "running" forever.
// Server-only.

import type { SupabaseClient } from '@supabase/supabase-js';
import { canViewPage } from '@/components/admin/adminTools';
import { agentsEveConfig } from '@/lib/agent/eve-config';
import { getAccess } from '@/lib/auth/access';
import type { CronJobContext } from '@/lib/cron/jobs';
import { createAskSessionToken } from '@/lib/knowledge/ask-token';
import {
  buildRoutineMessage,
  knowledgeHeaders,
  knowledgeScopeForAccess,
} from '@/lib/knowledge/scope';
import { createNotifications } from '@/lib/notifications/notify';
import { startEveSession } from '@/lib/schedule/eve-session';
import { type Cadence, nextRunAt, type RoutineView } from './cadence';
import { PYRE_AGENT_HREF } from './types';

export interface RoutineRow {
  id: string;
  owner_email: string;
  title: string;
  prompt: string;
  frequency: Cadence['frequency'];
  weekdays: number[];
  month_day: number | null;
  hour: number;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoutineRunRow {
  id: string;
  routine_id: string;
  scheduled_for: string;
  trigger: 'scheduled' | 'manual';
  status: 'running' | 'answered' | 'failed';
  session_id: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  created_at: string;
}

/** Routines started per tick; the rest wait an hour rather than blow the budget. */
const MAX_PER_TICK = 25;
/** A run the agent has not reported on in this long is settled from the audit log. */
const STALE_RUN_MS = 30 * 60 * 1000;
/** A routine's notice drops out of the inbox after a week. */
const NOTICE_DAYS = 7;
const EXCERPT_LENGTH = 220;

export function cadenceOf(
  row: Pick<RoutineRow, 'frequency' | 'weekdays' | 'month_day' | 'hour'>
): Cadence {
  return {
    frequency: row.frequency,
    weekdays: row.weekdays ?? [],
    monthDay: row.month_day,
    hour: row.hour,
  };
}

export function routineView(row: RoutineRow, lastRun: RoutineRunRow | null): RoutineView {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    cadence: cadenceOf(row),
    enabled: row.enabled,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastRun: lastRun
      ? {
          status: lastRun.status,
          sessionId: lastRun.session_id,
          error: lastRun.error,
          startedAt: lastRun.started_at,
        }
      : null,
  };
}

/** Where a run's answer opens: its conversation on the Pyre Agent page. */
export function runHref(sessionId: string): string {
  return `${PYRE_AGENT_HREF}?c=${encodeURIComponent(sessionId)}`;
}

/** Markdown to one plain line, for a notification body. */
function excerpt(markdown: string): string {
  const text = markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…` : text;
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

export type StartResult =
  | { ok: true; runId: string; sessionId: string; token: string | null }
  | { ok: false; error: string; runId: string | null };

async function failRun(db: SupabaseClient, runId: string, error: string): Promise<void> {
  await db
    .from('pyre_agent_routine_runs')
    .update({
      status: 'failed',
      error: error.slice(0, 1000),
      finished_at: new Date().toISOString(),
    })
    .eq('id', runId)
    .eq('status', 'running');
}

/**
 * Open a run's conversation. A scheduled run claims its slot first (one row
 * per routine and slot), so overlapping ticks start it once.
 */
export async function startRoutineRun(
  db: SupabaseClient,
  routine: RoutineRow,
  trigger: 'scheduled' | 'manual',
  scheduledFor: string
): Promise<StartResult> {
  const { data: inserted, error: insertError } = await db
    .from('pyre_agent_routine_runs')
    .insert({ routine_id: routine.id, scheduled_for: scheduledFor, trigger })
    .select('id')
    .single();
  if (insertError) {
    // 23505: this slot already ran (another tick got there first).
    return {
      ok: false,
      runId: null,
      error: insertError.code === '23505' ? 'already ran' : insertError.message,
    };
  }
  const runId = (inserted as { id: string }).id;
  // A scheduled run that cannot start tells its owner (nobody is watching);
  // Run now shows the error on the page instead.
  const fail = async (error: string): Promise<StartResult> => {
    if (trigger === 'scheduled') await finishRoutineRun(db, runId, { ok: false, error });
    else await failRun(db, runId, error);
    return { ok: false, runId, error };
  };

  const access = await getAccess(routine.owner_email);
  if (!access || !canViewPage(access, PYRE_AGENT_HREF)) {
    // Paused rather than retried every slot: it can only start working again
    // once someone gives the access back, and then its owner can resume it.
    await db
      .from('pyre_agent_routines')
      .update({ enabled: false, next_run_at: null })
      .eq('id', routine.id);
    return fail('The owner no longer has access to Pyre Agent, so the routine was paused');
  }

  const scope = await knowledgeScopeForAccess(routine.owner_email, access);
  const config = agentsEveConfig(knowledgeHeaders(scope, runId));
  if (!config) {
    return fail('Pyre Agent is not configured (AGENTS_BASE_URL / EVE_CHANNEL_SECRET)');
  }

  let sessionId: string | null;
  try {
    sessionId = await startEveSession(config, buildRoutineMessage(routine, routine.last_run_at));
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  if (!sessionId) return fail('The agent did not return a session');

  const now = new Date().toISOString();
  await Promise.all([
    db.from('pyre_agent_routine_runs').update({ session_id: sessionId }).eq('id', runId),
    db.from('pyre_agent_routines').update({ last_run_at: now }).eq('id', routine.id),
  ]);
  return {
    ok: true,
    runId,
    sessionId,
    token: createAskSessionToken(sessionId, routine.owner_email.trim().toLowerCase()),
  };
}

/**
 * Close a run and tell its owner. Only a run still 'running' is closed, so
 * the agent's report and the tick's sweep cannot both notify.
 */
export async function finishRoutineRun(
  db: SupabaseClient,
  runId: string,
  outcome: { ok: true } | { ok: false; error: string }
): Promise<boolean> {
  const { data, error } = await db
    .from('pyre_agent_routine_runs')
    .update({
      status: outcome.ok ? 'answered' : 'failed',
      error: outcome.ok ? null : outcome.error.slice(0, 1000),
      finished_at: new Date().toISOString(),
    })
    .eq('id', runId)
    .eq('status', 'running')
    .select('*')
    .maybeSingle();
  if (error || !data) return false;
  const run = data as RoutineRunRow;

  const { data: routineData } = await db
    .from('pyre_agent_routines')
    .select('*')
    .eq('id', run.routine_id)
    .maybeSingle();
  const routine = routineData as RoutineRow | null;
  if (!routine) return true;

  let body = outcome.ok ? '' : outcome.error;
  if (outcome.ok && run.session_id) {
    const { data: answerRow } = await db
      .from('knowledge_queries')
      .select('answer')
      .eq('session_id', run.session_id)
      .order('asked_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const answer = (answerRow as { answer: string | null } | null)?.answer;
    if (answer) body = excerpt(answer);
  }

  await createNotifications(db, [routine.owner_email], {
    kind: 'agent_routine',
    title: outcome.ok ? `${routine.title} is ready` : `${routine.title} did not finish`,
    body,
    href: run.session_id ? runHref(run.session_id) : `${PYRE_AGENT_HREF}/routines`,
    source: { type: 'pyre_agent_routine_run', id: run.id },
    expiresAt: daysFromNow(NOTICE_DAYS),
  });
  return true;
}

/**
 * Runs the agent never reported on: settled from the audit log (answered if
 * it holds an answer), or failed as lost.
 */
async function settleStaleRuns(db: SupabaseClient, dryRun: boolean): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RUN_MS).toISOString();
  const { data } = await db
    .from('pyre_agent_routine_runs')
    .select('*')
    .eq('status', 'running')
    .lt('started_at', cutoff)
    .limit(50);
  const runs = (data ?? []) as RoutineRunRow[];
  if (dryRun) return runs.length;
  for (const run of runs) {
    let answered = false;
    if (run.session_id) {
      const { data: rows } = await db
        .from('knowledge_queries')
        .select('status, answer')
        .eq('session_id', run.session_id);
      answered = ((rows ?? []) as { status: string; answer: string | null }[]).some(
        (row) => row.status === 'answered' || !!row.answer
      );
    }
    await finishRoutineRun(
      db,
      run.id,
      answered ? { ok: true } : { ok: false, error: 'The agent never finished this run' }
    );
  }
  return runs.length;
}

/** The cron job: start what is due, then settle what was lost. */
export async function runDueRoutines(ctx: CronJobContext): Promise<Record<string, unknown>> {
  const { getDb } = await import('@/lib/db');
  const db = getDb();
  if (!db) return { skipped: 'no-db' };

  const now = new Date();
  const { data, error } = await db
    .from('pyre_agent_routines')
    .select('*')
    .eq('enabled', true)
    .lte('next_run_at', now.toISOString())
    .order('next_run_at', { ascending: true })
    .limit(MAX_PER_TICK);
  if (error) throw new Error(error.message);
  const due = (data ?? []) as RoutineRow[];

  let started = 0;
  const failed: string[] = [];
  for (const routine of due) {
    if (ctx.timeRemainingMs() < 5_000) break;
    const slot = routine.next_run_at as string;
    if (ctx.dryRun) {
      started += 1;
      continue;
    }
    // Move the routine to its next slot before running this one, guarded on
    // the slot it held: two ticks racing can only advance it once. A routine
    // that missed slots (the tick was down) runs once, not once per slot.
    const { data: claimed } = await db
      .from('pyre_agent_routines')
      .update({ next_run_at: nextRunAt(cadenceOf(routine), now) })
      .eq('id', routine.id)
      .eq('next_run_at', slot)
      .select('id');
    if ((claimed ?? []).length === 0) continue;

    const result = await startRoutineRun(db, routine, 'scheduled', slot);
    if (result.ok) {
      started += 1;
    } else if (result.error !== 'already ran') {
      failed.push(`${routine.title}: ${result.error}`);
    }
  }

  const settled = await settleStaleRuns(db, ctx.dryRun);
  return { due: due.length, started, failed, settled, dryRun: ctx.dryRun };
}
