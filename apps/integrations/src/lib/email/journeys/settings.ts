// Per-journey pause switch, backed by the journey_settings table (see the
// journey_settings migration). Same shape as the email gate and the schedule
// settings: DB rows as source of truth, a ~30s in-process cache, explicit
// invalidation from the mutation route. A missing row (or an unreachable DB)
// reads as enabled — that's the pre-switch behavior, and failing closed would
// silently stall every journey on a DB blip.
//
// "Off" pauses rather than cancels. The engine consults this in all three
// places state can move (enrollFromEvent, runEnrollmentSweeps,
// advanceDueJourneys), so in-flight members simply hold their step.

import { getDb, type JourneySettingRow } from '@/lib/db';

const CACHE_TTL_MS = 30_000;
let cache: { rows: Record<string, boolean>; at: number } | null = null;

export function invalidateJourneySettingsCache(): void {
  cache = null;
}

/** Explicit switch rows, keyed by journey id. Journeys with no row are absent. */
export async function getJourneySettings(): Promise<Record<string, boolean>> {
  const db = getDb();
  if (!db) return cache?.rows ?? {};

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;

  const { data, error } = await db.from('journey_settings').select('journey_id, enabled');
  if (error) {
    console.error('[Journeys] settings fetch failed:', error.message);
    // A stale snapshot beats flapping to defaults mid-flight.
    return cache?.rows ?? {};
  }

  const rows = Object.fromEntries(
    (data as Pick<JourneySettingRow, 'journey_id' | 'enabled'>[]).map((r) => [
      r.journey_id,
      r.enabled,
    ])
  );
  cache = { rows, at: Date.now() };
  return rows;
}

/** Ids an admin has explicitly switched off — the engine's skip list. */
export async function getDisabledJourneyIds(): Promise<string[]> {
  const rows = await getJourneySettings();
  return Object.entries(rows)
    .filter(([, enabled]) => !enabled)
    .map(([id]) => id);
}

export async function setJourneyEnabled(
  journeyId: string,
  enabled: boolean,
  updatedBy: string | null
): Promise<{ error: string | null; resumed?: number }> {
  const db = getDb();
  if (!db) return { error: 'Storage unavailable' };

  const wasEnabled = (await getJourneySettings())[journeyId] ?? true;

  const { error } = await db
    .from('journey_settings')
    .upsert({ journey_id: journeyId, enabled, updated_by: updatedBy }, { onConflict: 'journey_id' });
  if (error) return { error: error.message };

  invalidateJourneySettingsCache();
  if (enabled && !wasEnabled) return { error: null, resumed: await resumeHeldEnrollments(journeyId) };
  return { error: null };
}

/**
 * Pull every step that came due while the journey was paused forward to now.
 *
 * Without this, a journey paused for a month leaves rows sorted a month deep at
 * the head of advanceDueJourneys()' `order by next_at asc` queue, so its
 * backlog would crowd out every other journey's genuinely-due sends batch after
 * batch. Later steps need no adjustment — advance() always schedules from
 * Date.now(), so the journey's normal spacing resumes on its own.
 */
async function resumeHeldEnrollments(journeyId: string): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  const now = new Date().toISOString();
  const { data, error } = await db
    .from('journey_enrollments')
    .update({ next_at: now })
    .eq('journey_id', journeyId)
    .eq('status', 'active')
    .lt('next_at', now)
    .select('id');

  if (error) {
    console.error(`[Journeys] resume reschedule failed for ${journeyId}:`, error.message);
    return 0;
  }
  return data?.length ?? 0;
}
