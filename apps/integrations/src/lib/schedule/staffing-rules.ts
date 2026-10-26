// The staffing_rules table behind the board's Settings panel: an ordered list
// of rules for how many people a shift needs (matching lives in
// @pyre/schedule-core staffing.ts). The editor saves the whole list at once —
// rows are upserted in order and anything no longer in the list is deleted.

import { parseStaffingRule, type StaffingRule } from '@pyre/schedule-core';
import { getDb } from '../db';

interface StaffingRuleRow {
  id: string;
  position: number;
  name: string;
  enabled: boolean;
  days: number[];
  shift_labels: string[];
  starts_from: string | null;
  starts_before: string | null;
  title_contains: string | null;
  tags: string[];
  staff_needed: number;
}

function fromRow(row: StaffingRuleRow): StaffingRule | null {
  const rule = parseStaffingRule({
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    days: row.days,
    shiftLabels: row.shift_labels,
    startsFrom: row.starts_from,
    startsBefore: row.starts_before,
    titleContains: row.title_contains,
    tags: row.tags,
    staffNeeded: row.staff_needed,
  });
  if (typeof rule === 'string') {
    console.warn(`[staffing-rules] skipping rule ${row.id}: ${rule}`);
    return null;
  }
  return rule;
}

/**
 * The rules in evaluation order, or null when they can't be read — the sync
 * then leaves existing head counts alone rather than resetting them all to
 * the fallback.
 */
export async function loadStaffingRules(): Promise<StaffingRule[] | null> {
  const db = getDb();
  if (!db) return null;
  const { data, error } = await db
    .from('staffing_rules')
    .select(
      'id, position, name, enabled, days, shift_labels, starts_from, starts_before, title_contains, tags, staff_needed'
    )
    .order('position', { ascending: true });
  if (error) {
    console.error('[staffing-rules] fetch failed:', error.message);
    return null;
  }
  return ((data ?? []) as StaffingRuleRow[])
    .map(fromRow)
    .filter((r): r is StaffingRule => r !== null);
}

/** Replace the whole ordered list. */
export async function saveStaffingRules(
  rules: StaffingRule[],
  updatedBy: string | null
): Promise<{ error: string | null }> {
  const db = getDb();
  if (!db) return { error: 'Storage unavailable' };

  if (rules.length > 0) {
    const { error } = await db.from('staffing_rules').upsert(
      rules.map((rule, position) => ({
        id: rule.id,
        position,
        name: rule.name,
        enabled: rule.enabled,
        days: rule.days,
        shift_labels: rule.shiftLabels,
        starts_from: rule.startsFrom,
        starts_before: rule.startsBefore,
        title_contains: rule.titleContains,
        tags: rule.tags,
        staff_needed: rule.staffNeeded,
        updated_by: updatedBy,
      })),
      { onConflict: 'id' }
    );
    if (error) return { error: error.message };
  }

  const keep = rules.map((r) => r.id);
  let remove = db.from('staffing_rules').delete();
  remove =
    keep.length > 0
      ? remove.not('id', 'in', `(${keep.map((id) => `"${id.replace(/"/g, '')}"`).join(',')})`)
      : remove.neq('id', '');
  const { error } = await remove;
  if (error) return { error: error.message };
  return { error: null };
}
