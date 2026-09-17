// The admin's standing instructions for the AI schedule drafter — the
// higher-level requirements that hold every week, as opposed to the one-run
// note the draft composer sends. Backed by the singleton
// schedule_agent_instructions row (see the migration of the same name).
//
// This app owns the writes; the agents app reads the same row when a
// scheduler session starts and folds it into the drafter's system prompt, so
// every draft run picks it up — board drafts, refinements, and the Monday
// cron draft alike. Same shape as lib/schedule/settings.ts: the row is the
// source of truth, with a ~30s in-process cache the mutation invalidates.

import { sanitizeStandingInstructions } from '@pyre/schedule-core';
import { getDb } from '../db';

export interface ScheduleAgentInstructions {
  /** The standing instructions; '' when the admin has never set or has cleared them. */
  content: string;
  /** Dashboard email of the admin who last saved them. */
  updatedBy: string | null;
  /** When they were last saved; null before the first save. */
  updatedAt: string | null;
}

const EMPTY: ScheduleAgentInstructions = { content: '', updatedBy: null, updatedAt: null };

const CACHE_TTL_MS = 30_000;
let cache: { value: ScheduleAgentInstructions; at: number } | null = null;

export function invalidateScheduleAgentInstructionsCache(): void {
  cache = null;
}

/**
 * The saved standing instructions. A missing row or an unreachable database
 * reads as empty — this is admin-facing copy, not a permission check, and the
 * agent side has its own fallback.
 */
export async function getScheduleAgentInstructions(): Promise<ScheduleAgentInstructions> {
  const db = getDb();
  if (!db) return EMPTY;

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const { data, error } = await db
    .from('schedule_agent_instructions')
    .select('content, updated_by, updated_at')
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[schedule-agent-instructions] fetch failed:', error.message);
    // A stale snapshot beats flapping to empty mid-flight.
    return cache?.value ?? EMPTY;
  }

  const value: ScheduleAgentInstructions = {
    content: sanitizeStandingInstructions(typeof data?.content === 'string' ? data.content : ''),
    updatedBy: (data?.updated_by as string | null) ?? null,
    updatedAt: (data?.updated_at as string | null) ?? null,
  };
  cache = { value, at: Date.now() };
  return value;
}

/**
 * Replace the standing instructions. `content` arrives raw from the admin
 * form; it is sanitised here so the stored text is already what the agent
 * will see. An empty string is a valid save — it clears them.
 */
export async function setScheduleAgentInstructions(
  content: string,
  updatedBy: string | null
): Promise<{ error: string | null; instructions: ScheduleAgentInstructions | null }> {
  const db = getDb();
  if (!db) return { error: 'Storage unavailable', instructions: null };

  const clean = sanitizeStandingInstructions(content);
  const { error } = await db
    .from('schedule_agent_instructions')
    .upsert({ id: true, content: clean, updated_by: updatedBy }, { onConflict: 'id' });
  if (error) return { error: error.message, instructions: null };

  invalidateScheduleAgentInstructionsCache();
  return { error: null, instructions: await getScheduleAgentInstructions() };
}
