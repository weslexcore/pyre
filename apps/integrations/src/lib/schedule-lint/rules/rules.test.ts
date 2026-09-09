import { describe, expect, it } from 'vitest';
import type { MomenceEvent } from '@/lib/momence-events';
import { horizonOf, normalizeFeed } from '../feed';
import { capacityOutlier, MIN_GROUP_SIZE } from './capacity-outlier';
import { DRAFT_SOON_DAYS, draftSoon } from './draft-soon';
import { duplicate } from './duplicate';
import { horizonShort, MIN_PUBLISHED_DAYS } from './horizon-short';
import type { LintRule } from './rule';
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

const run = (rule: LintRule, events: MomenceEvent[]) =>
  rule.run(normalizeFeed(events, { now: NOW }), { now: NOW, horizon: horizonOf({ now: NOW }) });

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

  it('needs enough siblings to call anything an outlier', () => {
    const rows = stack(MIN_GROUP_SIZE - 1);
    rows[0] = { ...rows[0], capacity: 4, spotsRemaining: 4 };
    expect(run(capacityOutlier, rows)).toEqual([]);
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

  it('is silent once the schedule reaches the minimum window', () => {
    const rows = [
      event({ id: 1, dateTime: et('2026-09-17', '18:00') }),
      event({ id: 2, dateTime: et(`2026-09-${14 + MIN_PUBLISHED_DAYS}`, '18:00') }),
    ];
    expect(run(horizonShort, rows)).toEqual([]);
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
