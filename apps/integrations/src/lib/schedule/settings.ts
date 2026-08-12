// Admin on/off switches for the employee-facing schedule actions, backed by
// the schedule_settings table (see the shift_requests_and_leads migration).
// Same shape as the email gate: DB rows as source of truth, a ~30s in-process
// cache, explicit invalidation from the mutation route. A missing row (or an
// unreachable DB) reads as enabled — these gate convenience features, and the
// mutations they guard re-check at request time anyway.

import { getDb } from '../db';

export const SCHEDULE_SETTING_KEYS = ['shift_requests', 'unable_to_work'] as const;
export type ScheduleSettingKey = (typeof SCHEDULE_SETTING_KEYS)[number];

export interface ScheduleSettings {
  /** Employees may request open shifts (manager approval creates the assignment). */
  shiftRequestsEnabled: boolean;
  /** Employees may pull themselves off an assigned shift ("unable to work"). */
  unableToWorkEnabled: boolean;
}

const CACHE_TTL_MS = 30_000;
let cache: { rows: Record<string, boolean>; at: number } | null = null;

export function invalidateScheduleSettingsCache(): void {
  cache = null;
}

async function loadRows(): Promise<Record<string, boolean> | null> {
  const db = getDb();
  if (!db) return null;

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;

  const { data, error } = await db.from('schedule_settings').select('key, enabled');
  if (error) {
    console.error('[schedule-settings] fetch failed:', error.message);
    // A stale snapshot beats flapping to defaults mid-flight.
    return cache?.rows ?? null;
  }

  const rows = Object.fromEntries(
    (data as Array<{ key: string; enabled: boolean }>).map((r) => [r.key, r.enabled])
  );
  cache = { rows, at: Date.now() };
  return rows;
}

export async function getScheduleSettings(): Promise<ScheduleSettings> {
  const rows = (await loadRows()) ?? {};
  return {
    shiftRequestsEnabled: rows.shift_requests ?? true,
    unableToWorkEnabled: rows.unable_to_work ?? true,
  };
}

export async function setScheduleSetting(
  key: ScheduleSettingKey,
  enabled: boolean,
  updatedBy: string | null
): Promise<{ error: string | null }> {
  const db = getDb();
  if (!db) return { error: 'Storage unavailable' };

  const { error } = await db
    .from('schedule_settings')
    .upsert({ key, enabled, updated_by: updatedBy }, { onConflict: 'key' });
  if (error) return { error: error.message };

  invalidateScheduleSettingsCache();
  return { error: null };
}
