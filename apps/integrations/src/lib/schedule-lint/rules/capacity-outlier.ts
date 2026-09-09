// A session whose capacity does not match its siblings. Sessions of one type
// and length are created from the same template, so within (type, length)
// the capacity is a constant — a 1h Open Hours slot is always N seats. One
// that differs was typed by hand, and a 1 or a 100 where 12 belongs either
// turns guests away or oversells the room.
//
// Grouped by type AND length because the long partners in a stack (2h, 3h,
// 4h Open Hours) legitimately carry a smaller capacity than the hourly slot.

import { type NormalizedSession, toRef } from '../feed';
import { typeLabel } from '../labels';
import type { Finding } from '../types';
import type { LintRule } from './rule';

/** Fewer sessions than this in a group and there is no norm to compare with. */
export const MIN_GROUP_SIZE = 6;

/** The most common value, or null when two values tie for it. */
function modeOf(values: number[]): number | null {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  let tie = false;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
      tie = false;
    } else if (count === bestCount) {
      tie = true;
    }
  }
  return tie ? null : best;
}

export const capacityOutlier: LintRule = {
  name: 'capacity-outlier',
  run(sessions: NormalizedSession[]): Finding[] {
    const groups = new Map<string, NormalizedSession[]>();
    for (const s of sessions) {
      if (!s.isPublished || s.isSpecialEvent || s.capacity === null) continue;
      const key = `${s.type}|${s.durationMinutes}`;
      const group = groups.get(key);
      if (group) group.push(s);
      else groups.set(key, [s]);
    }

    const findings: Finding[] = [];
    for (const group of groups.values()) {
      if (group.length < MIN_GROUP_SIZE) continue;
      const mode = modeOf(group.map((s) => s.capacity as number));
      if (mode === null) continue;
      for (const s of group) {
        if (s.capacity === mode) continue;
        findings.push({
          rule: 'capacity-outlier',
          severity: 'notice',
          key: `capacity:${s.id}:${s.capacity}`,
          session: toRef(s),
          message: `Capacity ${s.capacity}; the other ${typeLabel(s.type)} sessions of this length are ${mode}`,
        });
      }
    }
    return findings.sort(
      (a, b) =>
        Date.parse(a.session?.startsAt ?? '') - Date.parse(b.session?.startsAt ?? '') ||
        (a.session?.id ?? 0) - (b.session?.id ?? 0)
    );
  },
};
