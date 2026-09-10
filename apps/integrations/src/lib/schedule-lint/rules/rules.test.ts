import { describe, expect, it } from 'vitest';
import type { MomenceEvent } from '@/lib/momence-events';
import { horizonOf, normalizeFeed } from '../feed';
import { capacityOutlier, MIN_GROUP_SIZE } from './capacity-outlier';
import { DRAFT_SOON_DAYS, draftSoon } from './draft-soon';
import { duplicate } from './duplicate';
import { durationVariants } from './duration-variants';
import { expectedCapacity } from './expected-capacity';
import { horizonShort, MIN_PUBLISHED_DAYS } from './horizon-short';
import { dayKeyOf, openingHours, toMinutes } from './opening-hours';
import { requiredTag } from './required-tag';
import type { RuleDefinition } from './rule';
import { untagged } from './untagged';

// The rules that are not the overlap check. Same September 2026 fixtures:
// "now" is Monday Sep 14, 8:00 AM EDT, and the horizon runs to Oct 12.
const NOW = new Date('2026-09-14T12:00:00Z');

const et = (date: string, time: string): string =>
  new Date(`${date}T${time}:00-04:00`).toISOString();

let nextId = 100;
const event = (over: Partial<MomenceEvent> = {}): MomenceEvent => ({
  id: nextId++,
  title: 'Open Hours',
  tags: ['Open Hours'],
  dateTime: et('2026-09-17', '18:00'),
  duration: 60,
  location: 'Pyre Sauna',
  capacity: 12,
  spotsRemaining: 12,
  ...over,
});

const run = <P extends Record<string, unknown>>(
  rule: RuleDefinition<P>,
  events: MomenceEvent[],
  params: Partial<P> = {}
) =>
  rule.run(normalizeFeed(events, { now: NOW }), { now: NOW, horizon: horizonOf({ now: NOW }) }, {
    ...rule.defaults,
    ...params,
  } as P);

/** N hourly Open Hours slots on consecutive days from Sep 16. */
const stack = (n: number, over: Partial<MomenceEvent> = {}): MomenceEvent[] =>
  Array.from({ length: n }, (_, i) =>
    event({ id: 200 + i, dateTime: et(`2026-09-${16 + (i % 10)}`, '18:00'), ...over })
  );

describe('untagged', () => {
  it('flags a published session with no recognised type tag', () => {
    const findings = run(untagged, [
      event({ id: 1, title: 'Community Night', tags: [] }),
      event({ id: 2, title: 'Workshop', tags: ['Members Only'] }),
      event({ id: 3 }),
      event({ id: 4, tags: ['Special Event'] }),
      event({ id: 5, tags: [], published: false }),
    ]);
    expect(findings.map((f) => f.session?.id)).toEqual([1, 2]);
    expect(findings[0]).toMatchObject({ rule: 'untagged', severity: 'fix', key: 'untagged:1' });
    expect(findings[0].message).toContain('No session tag');
    expect(findings[1].message).toContain('Tagged "Members Only"');
  });
});

describe('draft-soon', () => {
  it('flags a draft that starts inside the window and leaves later ones alone', () => {
    const soon = event({ id: 1, published: false, dateTime: et('2026-09-18', '18:00') });
    const later = event({
      id: 2,
      published: false,
      dateTime: et(`2026-09-${14 + DRAFT_SOON_DAYS + 1}`, '18:00'),
    });
    const live = event({ id: 3, dateTime: et('2026-09-18', '18:00') });
    const findings = run(draftSoon, [later, soon, live]);
    expect(findings.map((f) => f.session?.id)).toEqual([1]);
    expect(findings[0]).toMatchObject({ rule: 'draft-soon', severity: 'fix', key: 'draft:1' });
    expect(findings[0].message).toBe(
      'Still a draft and starts Fri, Sep 18; publish it or delete it'
    );
  });
});

describe('duplicate', () => {
  it('flags every extra copy and points at the original', () => {
    const original = event({ id: 10 });
    const copy = event({ id: 11, spotsRemaining: 9 });
    const anotherCopy = event({ id: 12 });
    const findings = run(duplicate, [anotherCopy, copy, original]);
    expect(findings.map((f) => f.session?.id)).toEqual([11, 12]);
    expect(findings[0]).toMatchObject({
      rule: 'duplicate',
      severity: 'fix',
      key: 'duplicate:11',
      context: { id: 10 },
    });
    expect(findings[0].message).toContain('(this one has 3 booked)');
    expect(findings[1].message).not.toContain('this one has');
  });

  it('does not confuse a stack partner or a different room for a duplicate', () => {
    const findings = run(duplicate, [
      event({ id: 1 }),
      event({ id: 2, duration: 120 }),
      event({ id: 3, location: 'Annex' }),
      event({ id: 4, title: 'Open Hours — quiet' }),
      event({ id: 5, dateTime: et('2026-09-17', '19:00') }),
      event({ id: 6, published: false }),
    ]);
    expect(findings).toEqual([]);
  });

  it('matches titles and rooms case- and space-insensitively', () => {
    const findings = run(duplicate, [
      event({ id: 1, title: 'Open Hours', location: 'Pyre Sauna' }),
      event({ id: 2, title: ' open hours ', location: 'pyre sauna' }),
    ]);
    expect(findings.map((f) => f.session?.id)).toEqual([2]);
  });
});

describe('capacity-outlier', () => {
  it('flags the one session whose capacity differs from its siblings', () => {
    const rows = stack(MIN_GROUP_SIZE);
    rows[3] = { ...rows[3], capacity: 4, spotsRemaining: 4 };
    const findings = run(capacityOutlier, rows);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: 'capacity-outlier',
      severity: 'notice',
      key: `capacity:${rows[3].id}:4`,
      message: 'Capacity 4; the other Open hours sessions of this length are 12',
    });
  });

  it('needs enough siblings to call anything an outlier, as configured', () => {
    const rows = stack(MIN_GROUP_SIZE - 1);
    rows[0] = { ...rows[0], capacity: 4, spotsRemaining: 4 };
    expect(run(capacityOutlier, rows)).toEqual([]);
    expect(run(capacityOutlier, rows, { minGroup: 3 })).toHaveLength(1);
  });

  it('compares within type and length, so a 2h partner is not an outlier of the 1h slot', () => {
    const hourly = stack(MIN_GROUP_SIZE);
    const long = stack(MIN_GROUP_SIZE, { duration: 120, capacity: 4, spotsRemaining: 4 }).map(
      (e, i) => ({ ...e, id: 300 + i })
    );
    expect(run(capacityOutlier, [...hourly, ...long])).toEqual([]);
  });

  it('stays quiet when there is no single norm, and skips special events and drafts', () => {
    const split = stack(MIN_GROUP_SIZE).map((e, i) =>
      i % 2 ? { ...e, capacity: 8, spotsRemaining: 8 } : e
    );
    expect(run(capacityOutlier, split)).toEqual([]);

    const rows = stack(MIN_GROUP_SIZE);
    const odd = [
      event({ id: 400, capacity: 40, spotsRemaining: 40, tags: ['Open Hours', 'Special Event'] }),
      event({ id: 401, capacity: 40, spotsRemaining: 40, published: false }),
      event({ id: 402, capacity: undefined, spotsRemaining: undefined }),
    ];
    expect(run(capacityOutlier, [...rows, ...odd])).toEqual([]);
  });
});

describe('horizon-short', () => {
  it('flags a regular schedule that ends inside the minimum window', () => {
    const rows = [
      event({ id: 1, dateTime: et('2026-09-17', '18:00') }),
      event({ id: 2, tags: ['Social'], dateTime: et('2026-09-25', '19:00') }),
      // A guided session further out does not count as the regular schedule.
      event({ id: 3, tags: ['Guided'], dateTime: et('2026-10-09', '19:00') }),
    ];
    const findings = run(horizonShort, rows);
    expect(findings).toEqual([
      expect.objectContaining({
        rule: 'horizon-short',
        severity: 'notice',
        key: 'horizon-short:2026-09-25',
        session: null,
      }),
    ]);
    expect(findings[0].message).toContain('through Fri, Sep 25 only');
  });

  it('is silent once the schedule reaches the minimum window, as configured', () => {
    const rows = [
      event({ id: 1, dateTime: et('2026-09-17', '18:00') }),
      event({ id: 2, dateTime: et(`2026-09-${14 + MIN_PUBLISHED_DAYS}`, '18:00') }),
    ];
    expect(run(horizonShort, rows)).toEqual([]);
    expect(run(horizonShort, rows, { minDays: 21 })).toHaveLength(1);
    // A guided session counts once the regular schedule is said to include it.
    const guided = [event({ id: 3, tags: ['Guided'], dateTime: et('2026-10-09', '19:00') })];
    expect(run(horizonShort, guided)[0].key).toBe('horizon-short:none');
    expect(run(horizonShort, guided, { types: ['guided'] })).toEqual([]);
  });

  it('says so when nothing regular is published at all, ignoring drafts', () => {
    const findings = run(horizonShort, [
      event({ id: 1, published: false, dateTime: et('2026-10-01', '18:00') }),
      event({ id: 2, tags: ['Guided'], dateTime: et('2026-10-01', '18:00') }),
    ]);
    expect(findings[0]).toMatchObject({ key: 'horizon-short:none' });
    expect(findings[0].message).toContain('No Open Hours or Social sessions');
  });
});

// --- Custom rule kinds -------------------------------------------------------

describe('opening-hours', () => {
  it('reads ET weekdays and wall-clock minutes', () => {
    expect(dayKeyOf('2026-09-16')).toBe('wed');
    expect(dayKeyOf('2026-09-20')).toBe('sun');
    expect(toMinutes('16:30')).toBe(990);
  });

  it('flags closed days, early starts, and late finishes; leaves the rest alone', () => {
    const findings = run(openingHours, [
      event({ id: 1, dateTime: et('2026-09-16', '18:00') }), // Wed 6–7pm: fine
      event({ id: 2, dateTime: et('2026-09-14', '18:00') }), // Mon: closed
      event({ id: 3, dateTime: et('2026-09-17', '15:00') }), // Thu 3pm: before 4pm open
      event({ id: 4, dateTime: et('2026-09-17', '19:30'), duration: 60 }), // Thu ends 8:30 > 8pm
      event({ id: 5, dateTime: et('2026-09-18', '20:00') }), // Fri 8–9pm: fine (closes 9)
      event({ id: 6, tags: ['Special Event'], dateTime: et('2026-09-14', '20:00') }), // never checked
      event({ id: 7, published: false, dateTime: et('2026-09-14', '18:00') }),
    ]);
    expect(findings.map((f) => [f.session?.id, f.message])).toEqual([
      [2, 'On a Monday, when Pyre is closed'],
      [3, 'Starts before Thursday opening at 4:00 PM'],
      [4, 'Runs past Thursday close at 8:00 PM'],
    ]);
    expect(findings[0]).toMatchObject({ rule: 'opening-hours', severity: 'fix', key: 'hours:2' });
  });

  it('checks only the chosen types, and a session over midnight is past close', () => {
    const rows = [
      event({ id: 1, dateTime: et('2026-09-14', '18:00') }),
      event({ id: 2, tags: ['Guided'], dateTime: et('2026-09-14', '18:00') }),
      event({ id: 3, tags: ['Social'], dateTime: et('2026-09-18', '20:00'), duration: 5 * 60 }),
    ];
    expect(run(openingHours, rows, { types: ['guided'] }).map((f) => f.session?.id)).toEqual([2]);
    expect(run(openingHours, rows).map((f) => f.session?.id)).toEqual([1, 2, 3]);
    expect(run(openingHours, rows)[2].message).toBe('Runs past Friday close at 9:00 PM');
  });
});

describe('required-tag', () => {
  it('flags a title that promises a tag the session does not carry', () => {
    const findings = run(requiredTag, [
      event({ id: 1, title: 'Social Evening', tags: ['Open Hours'] }),
      event({ id: 2, title: 'social sauna', tags: ['social'] }),
      event({ id: 3, title: 'Open Hours', tags: [] }),
      event({ id: 4, title: 'Social Evening', tags: [], published: false }),
    ]);
    expect(findings.map((f) => f.session?.id)).toEqual([1]);
    expect(findings[0]).toMatchObject({
      rule: 'required-tag',
      severity: 'fix',
      key: 'tag:1:social',
      message: 'Title says "Social" but the session is not tagged Social',
    });
  });

  it('does nothing with blank settings', () => {
    expect(run(requiredTag, [event({ title: 'Social', tags: [] })], { tag: ' ' })).toEqual([]);
  });
});

describe('expected-capacity', () => {
  it('flags the matching type and length only', () => {
    const findings = run(expectedCapacity, [
      event({ id: 1, capacity: 12, spotsRemaining: 12 }),
      event({ id: 2, capacity: 10, spotsRemaining: 10 }),
      event({ id: 3, capacity: 4, spotsRemaining: 4, duration: 120 }),
      event({ id: 4, capacity: 10, spotsRemaining: 10, tags: ['Social'] }),
      event({ id: 5, capacity: undefined, spotsRemaining: undefined }),
      event({ id: 6, capacity: 10, spotsRemaining: 10, published: false }),
    ]);
    expect(findings.map((f) => f.session?.id)).toEqual([2]);
    expect(findings[0]).toMatchObject({
      rule: 'expected-capacity',
      severity: 'fix',
      key: 'expected-capacity:2:10',
      message: 'Capacity 10; 60-minute Open hours sessions should be 12',
    });
    expect(
      run(expectedCapacity, [event({ id: 3, capacity: 4, spotsRemaining: 4, duration: 120 })], {
        durationMinutes: 120,
        capacity: 6,
      })
    ).toHaveLength(1);
  });
});

describe('duration-variants', () => {
  // Thursday Sep 17, open 16:00–20:00 in the rule's default hours.
  const at = (time: string, over: Partial<MomenceEvent> = {}): MomenceEvent =>
    event({ dateTime: et('2026-09-17', time), ...over });

  it('flags the length a start time is missing and leaves a complete one alone', () => {
    const findings = run(durationVariants, [
      at('18:00', { id: 1 }),
      at('17:00', { id: 2 }),
      at('17:00', { id: 3, duration: 120 }),
    ]);
    expect(findings.map((f) => f.session?.id)).toEqual([1]);
    expect(findings[0]).toMatchObject({
      rule: 'duration-variants',
      severity: 'fix',
      key: 'variants:open hours:2026-09-17T22:00:00.000Z:120',
      message: 'No 2 hours Open hours option at this start time; only 1 hour',
    });
  });

  it('asks Social for all three lengths', () => {
    const findings = run(
      durationVariants,
      [event({ id: 1, tags: ['Social'], dateTime: et('2026-09-18', '16:00') })],
      { type: 'social', durations: [60, 120, 180] }
    );
    expect(findings.map((f) => f.message)).toEqual([
      'No 2 hours Social option at this start time; only 1 hour',
      'No 3 hours Social option at this start time; only 1 hour',
    ]);
  });

  it('stays quiet when the missing length would not fit', () => {
    // 19:00 + 2h runs an hour past the 20:00 close.
    expect(run(durationVariants, [at('19:00')])).toEqual([]);
    // Monday is closed, and 15:00 is before Thursday's open.
    expect(run(durationVariants, [event({ dateTime: et('2026-09-21', '18:00') })])).toEqual([]);
    expect(run(durationVariants, [at('15:00')])).toEqual([]);
  });

  it('stays quiet when a special event is in the way', () => {
    const special = at('19:00', {
      id: 9,
      title: 'DJ Night',
      tags: ['Special Event'],
      duration: 120,
    });
    expect(run(durationVariants, [at('18:00'), special])).toEqual([]);
    // A draft special event blocks nothing; it may never run.
    expect(run(durationVariants, [at('18:00'), { ...special, published: false }])).toHaveLength(1);
  });

  it('ignores drafts, special events, and other types when reading a slot', () => {
    const findings = run(durationVariants, [
      at('18:00', { id: 1 }),
      at('18:00', { id: 2, duration: 120, published: false }),
      at('18:00', { id: 3, duration: 120, tags: ['Social'] }),
    ]);
    expect(findings.map((f) => f.session?.id)).toEqual([1]);
  });
});
