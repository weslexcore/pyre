// Custom rule: a start time that offers some lengths but not others. Guests
// pick both when they arrive and how long they stay, so every Open Hours
// start should sell an hour and two hours, and every Social start an hour,
// two, and three. A start time that only sells the short one quietly loses
// the longer booking.
//
// The gap is only reported when it could actually be filled: the missing
// length has to finish before close on a day Pyre is open, and it must not
// run into a special event. That is the "when our hours and other events
// allow" half of the rule — otherwise every 8pm slot would be told to grow
// a three-hour twin it has no room for.

import { utcToEastern } from '@pyre/schedule-core';
import { type NormalizedSession, sameLocation, toRef } from '../feed';
import { formatDurationLabel, typeLabel } from '../labels';
import type { OpeningHours } from '../types';
import { dayKeyOf, toMinutes } from './opening-hours';
import type { RuleDefinition, RuleFinding } from './rule';
import { overlaps } from './special-event-overlap';

export interface DurationVariantsParams extends Record<string, unknown> {
  type: string;
  /** Every length, in minutes, a start time of this type should offer. */
  durations: number[];
  /** The hours a missing length has to fit inside; a closed day is skipped. */
  days: OpeningHours;
}

/**
 * The sessions of one type that share a start instant. Pyre has one venue,
 * so the instant alone identifies the slot; the anchor's location is what
 * the special-event check compares against.
 */
interface Slot {
  start: number;
  sessions: NormalizedSession[];
}

function slotsOf(sessions: NormalizedSession[], type: string): Slot[] {
  const byStart = new Map<number, NormalizedSession[]>();
  for (const s of sessions) {
    if (!s.isPublished || s.isSpecialEvent || s.type !== type) continue;
    const group = byStart.get(s.start);
    if (group) group.push(s);
    else byStart.set(s.start, [s]);
  }
  return [...byStart.entries()]
    .map(([start, group]) => ({
      start,
      // Shortest first: the anchor a finding hangs off is the slot's opener.
      sessions: group.sort((a, b) => a.durationMinutes - b.durationMinutes || a.id - b.id),
    }))
    .sort((a, b) => a.start - b.start);
}

export const durationVariants: RuleDefinition<DurationVariantsParams> = {
  kind: 'duration-variants',
  title: 'Missing length options',
  description:
    'Start times of one type that offer some lengths but not others. A missing length is only reported when it would still fit inside opening hours and clear of any special event.',
  builtIn: false,
  defaults: {
    type: 'open hours',
    durations: [60, 120],
    days: {
      sun: { open: '13:00', close: '16:00' },
      mon: null,
      tue: null,
      wed: { open: '16:00', close: '20:00' },
      thu: { open: '16:00', close: '20:00' },
      fri: { open: '16:00', close: '21:00' },
      sat: { open: '10:00', close: '16:00' },
    },
  },
  fields: [
    { key: 'type', label: 'Session type', type: 'type' },
    {
      key: 'durations',
      label: 'Lengths offered',
      type: 'durations',
      hint: 'Minutes, separated by commas — 60, 120 asks every start time for an hour and a two-hour option.',
      min: 5,
      max: 24 * 60,
    },
    {
      key: 'days',
      label: 'Open',
      type: 'opening-hours',
      hint: 'A missing length is only reported when it finishes before close.',
    },
  ],
  run(sessions: NormalizedSession[], _ctx, { type, durations, days }): RuleFinding[] {
    const specials = sessions.filter((s) => s.isPublished && s.isSpecialEvent);
    const findings: RuleFinding[] = [];

    for (const slot of slotsOf(sessions, type)) {
      const anchor = slot.sessions[0];
      const present = new Set(slot.sessions.map((s) => s.durationMinutes));
      const start = utcToEastern(new Date(slot.start).toISOString());
      const window = days[dayKeyOf(start.date)];
      // A slot on a closed day, or before opening, is the opening-hours
      // rule's finding to make; asking it for more lengths would pile on.
      if (!window || start.minutes < toMinutes(window.open)) continue;
      const close = toMinutes(window.close);

      for (const minutes of durations) {
        if (present.has(minutes)) continue;
        if (start.minutes + minutes > close) continue;

        const candidate = { start: slot.start, end: slot.start + minutes * 60_000 };
        const blocker = specials.find(
          (special) =>
            overlaps(candidate, special) && sameLocation(anchor.location, special.location)
        );
        if (blocker) continue;

        findings.push({
          rule: 'duration-variants',
          severity: 'fix',
          // The slot, not the anchor's id: the finding survives the anchor
          // being rebuilt in Momence, so it doesn't re-email as new.
          key: `variants:${type}:${new Date(slot.start).toISOString()}:${minutes}`,
          session: toRef(anchor),
          message: `No ${formatDurationLabel(minutes)} ${typeLabel(type)} option at this start time; only ${[
            ...present,
          ]
            .sort((a, b) => a - b)
            .map(formatDurationLabel)
            .join(', ')}`,
        });
      }
    }
    return findings;
  },
};
