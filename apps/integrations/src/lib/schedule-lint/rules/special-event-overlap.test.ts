import { describe, expect, it } from 'vitest';
import type { MomenceEvent } from '@/lib/momence-events';
import { bookingCountOf, horizonOf, isSpecialEvent, normalizeFeed } from '../feed';
import type { Finding } from '../types';
import { overlaps, specialEventOverlap } from './special-event-overlap';

// Fixtures are ET wall-clock in September 2026 (EDT, UTC-4). "now" is a
// Monday morning; the events sit in the Thursday and Friday of that week.
const NOW = new Date('2026-09-14T12:00:00Z'); // Mon Sep 14, 8:00 AM EDT

/** "2026-09-17 18:00" ET -> ISO UTC */
const et = (date: string, time: string): string => {
  const [h, m] = time.split(':').map(Number);
  return new Date(
    `${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-04:00`
  ).toISOString();
};

let nextId = 100;
const event = (over: Partial<MomenceEvent> = {}): MomenceEvent => ({
  id: nextId++,
  title: 'Open Hours',
  tags: ['Open Hours'],
  dateTime: et('2026-09-17', '18:00'),
  duration: 60,
  location: 'Pyre Sauna',
  capacity: 10,
  spotsRemaining: 7,
  link: 'https://momence.com/s/1',
  ...over,
});

const special = (over: Partial<MomenceEvent> = {}): MomenceEvent =>
  event({
    id: 1,
    title: 'Sound Bath with Anna',
    tags: ['Special Event'],
    dateTime: et('2026-09-17', '19:00'),
    duration: 120,
    ...over,
  });

const detect = (
  events: MomenceEvent[],
  params = specialEventOverlap.defaults
): Omit<Finding, 'ruleId' | 'ruleLabel'>[] =>
  specialEventOverlap.run(
    normalizeFeed(events, { now: NOW }),
    { now: NOW, horizon: horizonOf({ now: NOW }) },
    params
  );

/** Findings grouped by the special event they sit under, in report order. */
type RuleFinding = ReturnType<typeof detect>[number];

const grouped = (events: MomenceEvent[]) => {
  const groups = new Map<
    number,
    { eventId: number; sessionIds: number[]; findings: RuleFinding[] }
  >();
  for (const f of detect(events)) {
    const id = f.context?.id ?? -1;
    const g = groups.get(id) ?? { eventId: id, sessionIds: [], findings: [] };
    g.sessionIds.push(f.session?.id ?? -1);
    g.findings.push(f);
    groups.set(id, g);
  }
  return [...groups.values()];
};

describe('overlaps', () => {
  it('treats touching intervals as separate', () => {
    expect(overlaps({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(false);
    expect(overlaps({ start: 10, end: 20 }, { start: 0, end: 10 })).toBe(false);
  });

  it('catches partial and identical overlap', () => {
    expect(overlaps({ start: 0, end: 15 }, { start: 10, end: 20 })).toBe(true);
    expect(overlaps({ start: 10, end: 20 }, { start: 10, end: 20 })).toBe(true);
    expect(overlaps({ start: 12, end: 14 }, { start: 10, end: 20 })).toBe(true);
  });
});

describe('isSpecialEvent', () => {
  it('matches the tag regardless of case, spacing, or position', () => {
    expect(isSpecialEvent(['Social', ' special EVENT '])).toBe(true);
    expect(isSpecialEvent(['Social'])).toBe(false);
    expect(isSpecialEvent(undefined)).toBe(false);
  });
});

describe('bookingCountOf', () => {
  it('prefers capacity minus spots remaining', () => {
    expect(bookingCountOf(event({ capacity: 10, spotsRemaining: 7 }))).toBe(3);
  });
  it('falls back to ticketsSold, then null', () => {
    expect(
      bookingCountOf(event({ capacity: undefined, spotsRemaining: undefined, ticketsSold: 4 }))
    ).toBe(4);
    expect(
      bookingCountOf(
        event({ capacity: undefined, spotsRemaining: undefined, ticketsSold: undefined })
      )
    ).toBeNull();
  });
  it('never goes negative when bookings exceed capacity', () => {
    expect(bookingCountOf(event({ capacity: 10, spotsRemaining: 12 }))).toBe(0);
  });
});

describe('special-event-overlap', () => {
  it('lists the hourly slots and their longer partners under a special event', () => {
    // 7–9pm event over Open Hours at 6, 7, 8 (1h) plus 6–8 and 7–9 (2h).
    const slots = [
      event({ id: 10, dateTime: et('2026-09-17', '18:00'), duration: 60 }),
      event({ id: 11, dateTime: et('2026-09-17', '19:00'), duration: 60 }),
      event({ id: 12, dateTime: et('2026-09-17', '20:00'), duration: 60 }),
      event({ id: 13, dateTime: et('2026-09-17', '18:00'), duration: 120 }),
      event({ id: 14, dateTime: et('2026-09-17', '19:00'), duration: 120 }),
    ];
    const [group, ...rest] = grouped([special(), ...slots]);
    expect(rest).toHaveLength(0);
    expect(group.eventId).toBe(1);
    // 6–7pm touches the event and is left alone; the rest are in, ordered by
    // start then shortest first.
    expect(group.sessionIds).toEqual([13, 11, 14, 12]);
    expect(group.findings.every((f) => f.severity === 'cancel')).toBe(true);
    expect(group.findings[0]).toMatchObject({
      rule: 'special-event-overlap',
      key: 'overlap:1:13',
      message: 'Under Sound Bath with Anna; cancel it in Momence',
      session: { type: 'open hours', bookingCount: 3, capacity: 10, location: 'Pyre Sauna' },
      context: { id: 1, title: 'Sound Bath with Anna' },
    });
  });

  it('lists other session types as review, not cancel', () => {
    const guided = event({
      id: 20,
      title: 'Guided Heat',
      tags: ['Guided'],
      dateTime: et('2026-09-17', '19:00'),
    });
    const untagged = event({
      id: 21,
      title: 'Mystery',
      tags: [],
      dateTime: et('2026-09-17', '19:00'),
    });
    const [group] = grouped([special(), guided, untagged]);
    expect(group.findings).toEqual([
      expect.objectContaining({
        severity: 'notice',
        session: expect.objectContaining({ id: 20, type: 'guided' }),
      }),
      expect.objectContaining({
        severity: 'notice',
        session: expect.objectContaining({ id: 21, type: 'general' }),
      }),
    ]);
    expect(group.findings[0].message).toContain('check whether it should still run');
    // …unless the admins say guided sessions should be cancelled too.
    const widened = detect([special(), guided, untagged], {
      cancelTypes: ['open hours', 'guided'],
    });
    expect(widened.map((f) => f.severity)).toEqual(['cancel', 'notice']);
  });

  it('treats a session tagged Social AND Special Event as the special event', () => {
    const djNight = special({
      id: 2,
      title: 'DJ Night',
      tags: ['Social', 'Special Event'],
      dateTime: et('2026-09-18', '19:00'),
      duration: 180,
    });
    const socialSlot = event({
      id: 30,
      title: 'Social Evening',
      tags: ['Social'],
      dateTime: et('2026-09-18', '19:00'),
      duration: 60,
    });
    const [group] = grouped([djNight, socialSlot]);
    expect(group.eventId).toBe(2);
    expect(group.sessionIds).toEqual([30]);
  });

  it('never lists one special event under another', () => {
    const a = special({ id: 1 });
    const b = special({ id: 2, dateTime: et('2026-09-17', '20:00') });
    expect(detect([a, b])).toEqual([]);
  });

  it('ignores cancelled, deleted, unpublished, and zero-length rows on both sides', () => {
    const live = event({ id: 40, dateTime: et('2026-09-17', '19:00') });
    expect(detect([special({ isCancelled: true }), live])).toEqual([]);
    expect(detect([special({ isDeleted: true }), live])).toEqual([]);
    expect(detect([special({ published: false }), live])).toEqual([]);
    expect(detect([special({ duration: 0 }), live])).toEqual([]);
    expect(detect([special(), event({ ...live, isCancelled: true })])).toEqual([]);
    expect(detect([special(), event({ ...live, published: false })])).toEqual([]);
  });

  it('skips what is already over and what is past the horizon, keeps what is in progress', () => {
    const pastSpecial = special({ id: 3, dateTime: et('2026-09-13', '19:00') });
    const pastSlot = event({ id: 50, dateTime: et('2026-09-13', '19:00') });
    expect(detect([pastSpecial, pastSlot])).toEqual([]);

    const farSpecial = special({ id: 4, dateTime: et('2026-10-20', '19:00') });
    const farSlot = event({ id: 51, dateTime: et('2026-10-20', '19:00') });
    expect(detect([farSpecial, farSlot])).toEqual([]);

    // Started at 7:30 this morning, runs until 9 — "now" is 8am.
    const running = special({ id: 5, dateTime: et('2026-09-14', '07:30'), duration: 90 });
    const runningSlot = event({ id: 52, dateTime: et('2026-09-14', '08:00'), duration: 60 });
    expect(grouped([running, runningSlot])[0]?.sessionIds).toEqual([52]);
  });

  it('includes the last day of the horizon and excludes the day after', () => {
    // Horizon: Mon Sep 14 + 28 days = Mon Oct 12 00:00 ET exclusive.
    const lastDay = special({ id: 6, dateTime: et('2026-10-11', '19:00') });
    const lastDaySlot = event({ id: 60, dateTime: et('2026-10-11', '19:00') });
    expect(detect([lastDay, lastDaySlot])).toHaveLength(1);

    const dayAfter = special({ id: 7, dateTime: et('2026-10-12', '00:00') });
    const dayAfterSlot = event({ id: 61, dateTime: et('2026-10-12', '00:00') });
    expect(detect([dayAfter, dayAfterSlot])).toEqual([]);
  });

  it('applies the location rule: different rooms are fine, a blank room is here', () => {
    const otherRoom = event({ id: 70, location: 'Annex', dateTime: et('2026-09-17', '19:00') });
    expect(detect([special(), otherRoom])).toEqual([]);

    const blankRoom = event({ id: 71, location: '', dateTime: et('2026-09-17', '19:00') });
    expect(grouped([special(), blankRoom])[0]?.sessionIds).toEqual([71]);

    const blankSpecial = special({ location: undefined });
    expect(grouped([blankSpecial, otherRoom])[0]?.sessionIds).toEqual([70]);

    const caseDiff = event({
      id: 72,
      location: 'pyre sauna ',
      dateTime: et('2026-09-17', '19:00'),
    });
    expect(grouped([special(), caseDiff])[0]?.sessionIds).toEqual([72]);
  });

  it('reports a session under both special events it overlaps, with distinct keys', () => {
    const a = special({ id: 1, dateTime: et('2026-09-17', '18:00'), duration: 90 });
    const b = special({ id: 2, dateTime: et('2026-09-17', '19:00'), duration: 90 });
    const slot = event({ id: 80, dateTime: et('2026-09-17', '18:00'), duration: 180 });
    const groups = grouped([b, a, slot]);
    expect(groups.map((g) => g.eventId)).toEqual([1, 2]);
    expect(groups.every((g) => g.sessionIds[0] === 80)).toBe(true);
    expect(detect([b, a, slot]).map((f) => f.key)).toEqual(['overlap:1:80', 'overlap:2:80']);
  });

  it('catches the morning after a special event that runs past midnight', () => {
    const allNighter = special({ id: 8, dateTime: et('2026-09-18', '20:00'), duration: 14 * 60 });
    const saturdayMorning = event({ id: 90, dateTime: et('2026-09-19', '09:00'), duration: 60 });
    const saturdayNoon = event({ id: 91, dateTime: et('2026-09-19', '12:00'), duration: 60 });
    expect(grouped([allNighter, saturdayMorning, saturdayNoon])[0].sessionIds).toEqual([90]);
  });

  it('returns nothing when the feed has no special events', () => {
    expect(detect([event(), event(), event()])).toEqual([]);
  });

  it('copes with a malformed date and a string id', () => {
    const bad = event({ id: '55' as unknown as number, dateTime: 'not a date' });
    const strId = event({ id: '56' as unknown as number, dateTime: et('2026-09-17', '19:00') });
    expect(grouped([special(), bad, strId])[0].sessionIds).toEqual([56]);
  });
});
