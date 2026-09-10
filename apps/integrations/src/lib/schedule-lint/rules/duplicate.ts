// Two published sessions that are the same session: same title, type,
// location, start, and length. The stacked Open Hours pattern (an hourly slot
// plus 2h/3h/4h partners sharing its start) makes an accidental double-create
// easy, and a duplicate double-counts capacity against the occupancy pool
// while looking like one row to a guest.
//
// Length is part of the key on purpose: the 1h slot and its 2h partner share
// title, type, location, and start, and are not duplicates.

import { type NormalizedSession, norm, toRef } from '../feed';
import type { RuleDefinition, RuleFinding } from './rule';

const identity = (s: NormalizedSession): string =>
  [norm(s.title), s.type, norm(s.location ?? ''), s.start, s.durationMinutes].join('|');

export const duplicate: RuleDefinition = {
  kind: 'duplicate',
  title: 'Duplicate sessions',
  description:
    'Two published sessions with the same title, type, room, start, and length: an accidental double-create.',
  builtIn: true,
  defaults: {},
  fields: [],
  run(sessions: NormalizedSession[]): RuleFinding[] {
    const groups = new Map<string, NormalizedSession[]>();
    for (const s of sessions) {
      if (!s.isPublished) continue;
      const key = identity(s);
      const group = groups.get(key);
      if (group) group.push(s);
      else groups.set(key, [s]);
    }

    const findings: RuleFinding[] = [];
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      // The lowest id is the original; every later copy is the finding.
      group.sort((a, b) => a.id - b.id);
      const [kept, ...copies] = group;
      const context = toRef(kept);
      for (const copy of copies) {
        findings.push({
          rule: 'duplicate',
          severity: 'fix',
          key: `duplicate:${copy.id}`,
          session: toRef(copy),
          context,
          message: `Same title, time, and length as another session; delete one of them${
            copy.bookingCount ? ` (this one has ${copy.bookingCount} booked)` : ''
          }`,
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
