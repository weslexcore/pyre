// The pay schedule behind the schedule's paydays — the single pay_schedule
// row (see the pay_schedule migration), edited from the board's ⚙ Settings
// panel through /api/admin/pay-schedule. The dates come from
// paydaysBetween in @pyre/schedule-core; this only loads and saves the rule.
//
// Same shape as settings.ts: a ~30s in-process cache with explicit
// invalidation on save. A missing row or an unreachable DB reads as no pay
// schedule — no paydays shown, rather than ones that might be wrong.

import type { PaySchedule } from '@pyre/schedule-core';
import { getDb } from '../db';

interface PayScheduleRow {
  enabled: boolean;
  frequency: PaySchedule['frequency'];
  anchor_date: string | null;
  days_of_month: number[] | null;
  shift_rule: PaySchedule['shiftRule'];
}

const CACHE_TTL_MS = 30_000;
let cache: { schedule: PaySchedule | null; at: number } | null = null;

function fromRow(row: PayScheduleRow): PaySchedule {
  return {
    enabled: row.enabled,
    frequency: row.frequency,
    anchorDate: row.anchor_date,
    daysOfMonth: row.days_of_month ?? [],
    shiftRule: row.shift_rule,
  };
}

/** The pay schedule, or null when none has been set. */
export async function getPaySchedule(): Promise<PaySchedule | null> {
  const db = getDb();
  if (!db) return null;

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.schedule;

  const { data, error } = await db
    .from('pay_schedule')
    .select('enabled, frequency, anchor_date, days_of_month, shift_rule')
    .maybeSingle();
  if (error) {
    console.error('[pay-schedule] fetch failed:', error.message);
    return cache?.schedule ?? null;
  }

  const schedule = data ? fromRow(data as PayScheduleRow) : null;
  cache = { schedule, at: Date.now() };
  return schedule;
}

export async function setPaySchedule(
  schedule: PaySchedule,
  updatedBy: string | null
): Promise<{ error: string | null }> {
  const db = getDb();
  if (!db) return { error: 'Storage unavailable' };

  const { error } = await db.from('pay_schedule').upsert(
    {
      id: true,
      enabled: schedule.enabled,
      frequency: schedule.frequency,
      anchor_date: schedule.anchorDate,
      days_of_month: schedule.daysOfMonth,
      shift_rule: schedule.shiftRule,
      updated_by: updatedBy,
    },
    { onConflict: 'id' }
  );
  if (error) return { error: error.message };

  cache = null;
  return { error: null };
}
