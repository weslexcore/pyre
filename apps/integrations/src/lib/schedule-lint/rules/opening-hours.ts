// Custom rule: sessions outside the opening hours an admin writes down.
// Nothing in the repo knows when Pyre is open — the landing page's hours are
// marketing copy in another workspace — so this is where the admins tell the
// lint, and a slot created on a Monday, or running past close, gets flagged.
//
// Special events are never checked: a DJ night until 2am is the point.

import { utcToEastern } from '@pyre/schedule-core';
import { type NormalizedSession, toRef } from '../feed';
import { formatClockLabel } from '../labels';
import { DAY_KEYS, type DayKey, type OpeningHours } from '../types';
import type { RuleDefinition, RuleFinding } from './rule';

export interface OpeningHoursParams extends Record<string, unknown> {
  days: OpeningHours;
  /** Empty = every type. */
  types: string[];
}

const DAY_LABEL: Record<DayKey, string> = {
  sun: 'Sunday',
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
};

/** "16:00" -> 960 */
export const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** The ET weekday of an ET calendar date. */
export function dayKeyOf(date: string): DayKey {
  return DAY_KEYS[new Date(`${date}T00:00:00`).getDay()];
}

export const openingHours: RuleDefinition<OpeningHoursParams> = {
  kind: 'opening-hours',
  title: 'Outside opening hours',
  description:
    'Sessions on a closed day, or starting before open or running past close. Special events are never checked.',
  builtIn: false,
  defaults: {
    days: {
      sun: { open: '13:00', close: '16:00' },
      mon: null,
      tue: null,
      wed: { open: '16:00', close: '20:00' },
      thu: { open: '16:00', close: '20:00' },
      fri: { open: '16:00', close: '21:00' },
      sat: { open: '10:00', close: '16:00' },
    },
    types: [],
  },
  fields: [
    { key: 'days', label: 'Open', type: 'opening-hours' },
    {
      key: 'types',
      label: 'Only check these types',
      type: 'types',
      hint: 'Leave empty to check every type.',
    },
  ],
  run(sessions: NormalizedSession[], _ctx, { days, types }): RuleFinding[] {
    const findings: RuleFinding[] = [];
    for (const s of sessions) {
      if (!s.isPublished || s.isSpecialEvent) continue;
      if (types.length > 0 && !types.includes(s.type)) continue;

      const start = utcToEastern(new Date(s.start).toISOString());
      const end = utcToEastern(new Date(s.end).toISOString());
      const day = dayKeyOf(start.date);
      const window = days[day];

      let problem: string | null = null;
      if (!window) {
        problem = `On a ${DAY_LABEL[day]}, when Pyre is closed`;
      } else {
        const open = toMinutes(window.open);
        const close = toMinutes(window.close);
        // A session crossing midnight ends "tomorrow"; measure it past 24:00.
        const endMinutes = end.date === start.date ? end.minutes : end.minutes + 24 * 60;
        if (start.minutes < open) {
          problem = `Starts before ${DAY_LABEL[day]} opening at ${formatClockLabel(window.open)}`;
        } else if (endMinutes > close) {
          problem = `Runs past ${DAY_LABEL[day]} close at ${formatClockLabel(window.close)}`;
        }
      }
      if (!problem) continue;

      findings.push({
        rule: 'opening-hours',
        severity: 'fix',
        key: `hours:${s.id}`,
        session: toRef(s),
        message: problem,
      });
    }
    return findings.sort(
      (a, b) =>
        Date.parse(a.session?.startsAt ?? '') - Date.parse(b.session?.startsAt ?? '') ||
        (a.session?.id ?? 0) - (b.session?.id ?? 0)
    );
  },
};
