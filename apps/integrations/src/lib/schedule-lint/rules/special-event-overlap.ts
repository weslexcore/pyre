// Regular sessions sitting under a special event. The schedule is built by
// hand as stacks of overlapping sessions (hourly Open Hours slots, Friday
// Social evenings), and when a one-off special event (Momence tag "Special
// Event") is added on top, the regular sessions in that window have to be
// cancelled or guests keep booking into a private event.
//
// Pure — every edge case (touching intervals, multi-day events, a slot under
// two events, the tag-order trap) is a unit test rather than a surprise.

import { type NormalizedSession, sameLocation, toRef } from '../feed';
import { type Finding, PRESELECT_TYPES } from '../types';
import type { LintRule } from './rule';

/**
 * Strict overlap — touching intervals (one ends exactly when the other
 * starts) are not conflicts. Sessions at Pyre are booked back to back.
 */
export function overlaps(a: { start: number; end: number }, b: { start: number; end: number }) {
  return a.start < b.end && a.end > b.start;
}

/**
 * One finding per (special event, overlapping session) pair. A session under
 * two special events is reported under both; the email groups by event.
 * Within an event the sessions come in start order, shortest first (an hour
 * slot before the 2h partner sharing its start), then by id.
 */
export const specialEventOverlap: LintRule = {
  name: 'special-event-overlap',
  run(sessions: NormalizedSession[]): Finding[] {
    const live = sessions.filter((s) => s.isPublished);
    const specials = live
      .filter((s) => s.isSpecialEvent)
      .sort((a, b) => a.start - b.start || a.id - b.id);
    const candidates = live.filter((s) => !s.isSpecialEvent);

    const findings: Finding[] = [];
    for (const special of specials) {
      const under = candidates
        .filter((c) => overlaps(c, special) && sameLocation(c.location, special.location))
        .sort((a, b) => a.start - b.start || a.durationMinutes - b.durationMinutes || a.id - b.id);
      const context = toRef(special);
      for (const session of under) {
        const cancel = PRESELECT_TYPES.includes(session.type);
        findings.push({
          rule: 'special-event-overlap',
          severity: cancel ? 'cancel' : 'notice',
          key: `overlap:${special.id}:${session.id}`,
          session: toRef(session),
          context,
          message: cancel
            ? `Under ${special.title}; cancel it in Momence`
            : `Under ${special.title}; check whether it should still run`,
        });
      }
    }
    return findings;
  },
};
