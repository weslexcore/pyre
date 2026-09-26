// Admin settings for the staff schedule, backed by the schedule_settings
// table (see the shift_requests_and_leads and shift_arrival_departure
// migrations): on/off switches for the employee-facing actions, and how long
// before the first session staff arrive and after the last one they leave.
// Same shape as the email gate: DB rows as source of truth, a ~30s in-process
// cache, explicit invalidation from the mutation route. A missing row (or an
// unreachable DB) reads as enabled / the built-in minutes — the switches gate
// convenience features, and the mutations they guard re-check at request time
// anyway.

import {
  DEFAULT_ARRIVE_BEFORE_MIN,
  DEFAULT_LEAVE_AFTER_MIN,
  MAX_SHIFT_BUFFER_MIN,
  type ShiftBufferSettings,
} from '@pyre/schedule-core';
import { getDb } from '../db';

export const SCHEDULE_SETTING_KEYS = ['shift_requests', 'sub_requests'] as const;
export type ScheduleSettingKey = (typeof SCHEDULE_SETTING_KEYS)[number];

/** The minute-count settings: when staff arrive and leave, from the sessions. */
export const SCHEDULE_MINUTE_SETTING_KEYS = ['arrive_before_min', 'leave_after_min'] as const;
export type ScheduleMinuteSettingKey = (typeof SCHEDULE_MINUTE_SETTING_KEYS)[number];

export interface ScheduleSettings extends ShiftBufferSettings {
  /** Employees may request open shifts (manager approval creates the assignment). */
  shiftRequestsEnabled: boolean;
  /** Employees may request a sub for a shift they're assigned to. */
  subRequestsEnabled: boolean;
}

interface SettingRow {
  enabled: boolean | null;
  minutes: number | null;
}

const CACHE_TTL_MS = 30_000;
let cache: { rows: Record<string, SettingRow>; at: number } | null = null;

export function invalidateScheduleSettingsCache(): void {
  cache = null;
}

async function loadRows(): Promise<Record<string, SettingRow> | null> {
  const db = getDb();
  if (!db) return null;

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;

  const { data, error } = await db.from('schedule_settings').select('key, enabled, minutes');
  if (error) {
    console.error('[schedule-settings] fetch failed:', error.message);
    // A stale snapshot beats flapping to defaults mid-flight.
    return cache?.rows ?? null;
  }

  const rows = Object.fromEntries(
    (data as Array<SettingRow & { key: string }>).map((r) => [
      r.key,
      { enabled: r.enabled, minutes: r.minutes },
    ])
  );
  cache = { rows, at: Date.now() };
  return rows;
}

export async function getScheduleSettings(): Promise<ScheduleSettings> {
  const rows = (await loadRows()) ?? {};
  return {
    shiftRequestsEnabled: rows.shift_requests?.enabled ?? true,
    subRequestsEnabled: rows.sub_requests?.enabled ?? true,
    arriveBeforeMin: rows.arrive_before_min?.minutes ?? DEFAULT_ARRIVE_BEFORE_MIN,
    leaveAfterMin: rows.leave_after_min?.minutes ?? DEFAULT_LEAVE_AFTER_MIN,
  };
}

/** Just the arrive-before / leave-after minutes, for defaulting a new assignment's hours. */
export async function getShiftBufferSettings(): Promise<ShiftBufferSettings> {
  const { arriveBeforeMin, leaveAfterMin } = await getScheduleSettings();
  return { arriveBeforeMin, leaveAfterMin };
}

/** A minute setting's value if it's a whole number of minutes in range, else null. */
export function parseSettingMinutes(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_SHIFT_BUFFER_MIN
    ? value
    : null;
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

/**
 * Save a minute setting. Only ever read when someone is next added to a
 * shift — hours already on the board keep what they were given.
 */
export async function setScheduleMinuteSetting(
  key: ScheduleMinuteSettingKey,
  minutes: number,
  updatedBy: string | null
): Promise<{ error: string | null }> {
  const db = getDb();
  if (!db) return { error: 'Storage unavailable' };

  const { error } = await db
    .from('schedule_settings')
    .upsert({ key, minutes, enabled: null, updated_by: updatedBy }, { onConflict: 'key' });
  if (error) return { error: error.message };

  invalidateScheduleSettingsCache();
  return { error: null };
}
