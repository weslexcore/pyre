import { describe, expect, it } from 'vitest';
import type { MomenceEvent } from '@/lib/momence-events';
import {
  bookingCountOf,
  findSessionConflicts,
  isSpecialEvent,
  mergeDetection,
  overlaps,
  reviewStatusFor,
  uniqueSessionIds,
} from './detect';
import type { Resolution, SessionConflict } from './types';

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

const detect = (events: MomenceEvent[]) => findSessionConflicts(events, { now: NOW });

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

describe('findSessionConflicts', () => {
  it('lists the hourly slots and their longer partners under a special event', () => {
    // 7–9pm event over Open Hours at 6, 7, 8 (1h) plus 6–8 and 7–9 (2h).
    const slots = [
      event({ id: 10, dateTime: et('2026-09-17', '18:00'), duration: 60 }),
      event({ id: 11, dateTime: et('2026-09-17', '19:00'), duration: 60 }),
      event({ id: 12, dateTime: et('2026-09-17', '20:00'), duration: 60 }),
      event({ id: 13, dateTime: et('2026-09-17', '18:00'), duration: 120 }),
      event({ id: 14, dateTime: et('2026-09-17', '19:00'), duration: 120 }),
    ];
    const [group, ...rest] = detect([special(), ...slots]);
    expect(rest).toHaveLength(0);
    expect(group.specialEvent.id).toBe(1);
    // 6–7pm touches the event and is left alone; the rest are in, ordered by
    // start then shortest first.
    expect(group.sessions.map((s) => s.id)).toEqual([13, 11, 14, 12]);
    expect(group.sessions.every((s) => s.preselected)).toBe(true);
    expect(group.sessions[0]).toMatchObject({
      type: 'open hours',
      tag: 'Open Hours',
      bookingCount: 3,
      capacity: 10,
      location: 'Pyre Sauna',
    });
  });

  it('lists but does not preselect other session types', () => {
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
    const [group] = detect([special(), guided, untagged]);
    expect(group.sessions).toEqual([
      expect.objectContaining({ id: 20, type: 'guided', tag: 'Guided', preselected: false }),
      expect.objectContaining({ id: 21, type: 'general', tag: null, preselected: false }),
    ]);
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
    const [group] = detect([djNight, socialSlot]);
    expect(group.specialEvent.id).toBe(2);
    expect(group.sessions.map((s) => s.id)).toEqual([30]);
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
    expect(detect([running, runningSlot])[0]?.sessions.map((s) => s.id)).toEqual([52]);
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
    expect(detect([special(), blankRoom])[0]?.sessions.map((s) => s.id)).toEqual([71]);

    const blankSpecial = special({ location: undefined });
    expect(detect([blankSpecial, otherRoom])[0]?.sessions.map((s) => s.id)).toEqual([70]);

    const caseDiff = event({
      id: 72,
      location: 'pyre sauna ',
      dateTime: et('2026-09-17', '19:00'),
    });
    expect(detect([special(), caseDiff])[0]?.sessions.map((s) => s.id)).toEqual([72]);
  });

  it('puts a session under both special events it overlaps, counted once', () => {
    const a = special({ id: 1, dateTime: et('2026-09-17', '18:00'), duration: 90 });
    const b = special({ id: 2, dateTime: et('2026-09-17', '19:00'), duration: 90 });
    const slot = event({ id: 80, dateTime: et('2026-09-17', '18:00'), duration: 180 });
    const groups = detect([b, a, slot]);
    expect(groups.map((g) => g.specialEvent.id)).toEqual([1, 2]);
    expect(groups.every((g) => g.sessions[0].id === 80)).toBe(true);
    expect(uniqueSessionIds(groups)).toEqual([80]);
  });

  it('catches the morning after a special event that runs past midnight', () => {
    const allNighter = special({ id: 8, dateTime: et('2026-09-18', '20:00'), duration: 14 * 60 });
    const saturdayMorning = event({ id: 90, dateTime: et('2026-09-19', '09:00'), duration: 60 });
    const saturdayNoon = event({ id: 91, dateTime: et('2026-09-19', '12:00'), duration: 60 });
    expect(
      detect([allNighter, saturdayMorning, saturdayNoon])[0].sessions.map((s) => s.id)
    ).toEqual([90]);
  });

  it('returns nothing when the feed has no special events', () => {
    expect(detect([event(), event(), event()])).toEqual([]);
  });

  it('copes with a malformed date and a string id', () => {
    const bad = event({ id: '55' as unknown as number, dateTime: 'not a date' });
    const strId = event({ id: '56' as unknown as number, dateTime: et('2026-09-17', '19:00') });
    const [group] = detect([special(), bad, strId]);
    expect(group.sessions.map((s) => s.id)).toEqual([56]);
  });
});

// --- Merging a fresh run into an open review ------------------------------

const group = (eventId: number, sessionIds: number[]): SessionConflict => ({
  specialEvent: {
    id: eventId,
    title: `Event ${eventId}`,
    startsAt: et('2026-09-17', '19:00'),
    endsAt: et('2026-09-17', '21:00'),
    location: null,
    link: null,
  },
  sessions: sessionIds.map((id) => ({
    id,
    title: `Slot ${id}`,
    tag: 'Open Hours',
    type: 'open hours',
    startsAt: et('2026-09-17', '19:00'),
    endsAt: et('2026-09-17', '20:00'),
    location: null,
    bookingCount: 0,
    capacity: 10,
    link: null,
    preselected: true,
  })),
});

describe('mergeDetection', () => {
  it('keeps what the admin saw and marks a vanished session cleared', () => {
    const prev = [group(1, [10, 11])];
    const next = [group(1, [11])];
    const { conflicts, resolution } = mergeDetection(prev, {}, next, NOW, 'admin@pyre.test');
    expect(conflicts[0].sessions.map((s) => s.id)).toEqual([11, 10]);
    expect(resolution['10']).toMatchObject({ outcome: 'cleared', by: 'admin@pyre.test' });
    expect(resolution['11']).toBeUndefined();
  });

  it('does not overwrite an outcome already recorded', () => {
    const prev = [group(1, [10])];
    const failed: Resolution = { '10': { outcome: 'failed', at: 'x', by: 'y', message: '500' } };
    const { resolution } = mergeDetection(prev, failed, [], NOW, 'admin');
    // failed is not handled, so a vanished session flips to cleared…
    expect(resolution['10'].outcome).toBe('cleared');
    // …but a cancelled one stays cancelled.
    const done: Resolution = { '10': { outcome: 'cancelled', at: 'x', by: 'y' } };
    expect(mergeDetection(prev, done, [], NOW, 'admin').resolution['10'].outcome).toBe('cancelled');
  });

  it('keeps a special event only while it still has sessions to show', () => {
    const prev = [group(1, [10]), group(2, [20])];
    const next = [group(3, [30])];
    const { conflicts } = mergeDetection(prev, {}, next, NOW, 'admin');
    expect(conflicts.map((g) => g.specialEvent.id)).toEqual([1, 2, 3]);
    // With nothing gone, an old group with no fresh counterpart is dropped.
    const { conflicts: again } = mergeDetection([group(1, [])], {}, next, NOW, 'admin');
    expect(again.map((g) => g.specialEvent.id)).toEqual([3]);
  });
});

describe('reviewStatusFor', () => {
  const conflicts = [group(1, [10, 11]), group(2, [11, 12])];
  const entry = (outcome: Resolution[string]['outcome']) => ({ outcome, at: 'x', by: 'y' });

  it('is resolved only once every distinct session is handled', () => {
    expect(reviewStatusFor(conflicts, {})).toBe('pending');
    expect(reviewStatusFor(conflicts, { '10': entry('cancelled'), '11': entry('skipped') })).toBe(
      'pending'
    );
    expect(
      reviewStatusFor(conflicts, {
        '10': entry('cancelled'),
        '11': entry('skipped'),
        '12': entry('cleared'),
      })
    ).toBe('resolved');
  });

  it('does not count failed or unsupported as handled', () => {
    expect(
      reviewStatusFor(conflicts, {
        '10': entry('cancelled'),
        '11': entry('failed'),
        '12': entry('unsupported'),
      })
    ).toBe('pending');
  });

  it('is resolved for an empty review', () => {
    expect(reviewStatusFor([], {})).toBe('resolved');
  });
});
