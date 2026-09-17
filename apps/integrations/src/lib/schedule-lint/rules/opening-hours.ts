// Custom rule: sessions outside the opening hours an admin writes down.
// Nothing in the repo knows when Pyre is open — the landing page's hours are
// marketing copy in another workspace — so this is where the admins tell the
// lint, and a slot created on a Monday, or running past close, gets flagged.
//
// A day can open more than once (Thursday runs a morning block and an evening
// block), so each block is checked on its own: a slot in the gap between them
// is as much a finding as one past the last close.
//
// Special events are never checked: a DJ night until 2am is the point.

import { utcToEastern } from '@pyre/schedule-core';
import { type NormalizedSession, toRef } from '../feed';
import { formatClockLabel } from '../labels';
import {
  DAY_KEYS,
  type DayKey,
  type DayWindow,
  type DayWindows,
  type OpeningHours,
} from '../types';
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

/**
 * The day's open block a wall-clock minute falls inside, or null — on a
 * closed day, before the first open, or in the gap of a split day.
 */
export function blockAt(blocks: DayWindows, minutes: number): DayWindow | null {
  return blocks.find((b) => minutes >= toMinutes(b.open) && minutes < toMinutes(b.close)) ?? null;
}

export const openingHours: RuleDefinition<OpeningHoursParams> = {
  kind: 'opening-hours',
  title: 'Outside opening hours',
  description:
    'Sessions on a closed day, or starting outside an open block or running past its close. Special events are never checked.',
  builtIn: false,
  defaults: {
    days: {
      sun: [{ open: '13:00', close: '20:00' }],
      mon: [],
      tue: [],
      wed: [{ open: '16:00', close: '20:00' }],
      thu: [
        { open: '07:00', close: '10:00' },
        { open: '16:00', close: '20:00' },
      ],
      fri: [{ open: '16:00', close: '21:00' }],
      sat: [{ open: '09:00', close: '20:00' }],
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
      const blocks = days[day];

      let problem: string | null = null;
      if (blocks.length === 0) {
        problem = `On a ${DAY_LABEL[day]}, when Pyre is closed`;
      } else if (start.minutes < toMinutes(blocks[0].open)) {
        problem = `Starts before ${DAY_LABEL[day]} opening at ${formatClockLabel(blocks[0].open)}`;
      } else {
        const block = blockAt(blocks, start.minutes);
        if (!block) {
          // Past a close on a day that opens again later, or after the last one.
          // start is at or past the first open, so a previous block always exists.
          const previous =
            blocks.filter((b) => toMinutes(b.close) <= start.minutes).at(-1) ?? blocks[0];
          const next = blocks.find((b) => toMinutes(b.open) > start.minutes);
          problem = next
            ? `Starts between the ${formatClockLabel(previous.close)} close and the ${formatClockLabel(
                next.open
              )} open on ${DAY_LABEL[day]}`
            : `Starts after ${DAY_LABEL[day]} close at ${formatClockLabel(previous.close)}`;
        } else {
          // A session crossing midnight ends "tomorrow"; measure it past 24:00.
          const endMinutes = end.date === start.date ? end.minutes : end.minutes + 24 * 60;
          if (endMinutes > toMinutes(block.close)) {
            problem = `Runs past ${DAY_LABEL[day]} close at ${formatClockLabel(block.close)}`;
          }
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
