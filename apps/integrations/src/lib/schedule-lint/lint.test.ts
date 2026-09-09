import { describe, expect, it } from 'vitest';
import type { MomenceEvent } from '@/lib/momence-events';
import { buildEmailProps } from './email';
import { countFindings, digestOf, runLint } from './lint';

// "now" is Monday Sep 14 2026, 8:00 AM EDT; the horizon runs to Oct 12.
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
  link: 'https://momence.com/s/1',
  ...over,
});

/**
 * A healthy four weeks: hourly Open Hours on Wed–Sun through Oct 11, all the
 * same capacity, all tagged, nothing in draft. Every rule should be silent.
 */
function cleanSchedule(): MomenceEvent[] {
  const rows: MomenceEvent[] = [];
  let id = 1000;
  for (let day = 16; day <= 41; day += 1) {
    const date = new Date(Date.UTC(2026, 8, day)); // Sep 16 .. Oct 11
    const iso = date.toISOString().slice(0, 10);
    if ([1, 2].includes(date.getUTCDay())) continue; // closed Mon/Tue
    for (const hour of ['16:00', '17:00', '18:00', '19:00']) {
      rows.push(event({ id: id++, dateTime: et(iso, hour) }));
    }
  }
  return rows;
}

describe('runLint', () => {
  it('finds nothing wrong with a healthy schedule', () => {
    const report = runLint(cleanSchedule(), { now: NOW });
    expect(report.findings).toEqual([]);
    expect(report.horizonStart).toBe('2026-09-14');
    expect(report.horizonEnd).toBe('2026-10-12');
    expect(report.digest).toBe(digestOf([]));
  });

  it('orders findings cancel, fix, notice, then by when', () => {
    const feed = [
      ...cleanSchedule(),
      // A special event on Oct 3 over the 6pm and 7pm slots — two cancels.
      event({
        id: 1,
        title: 'DJ Night',
        tags: ['Special Event'],
        dateTime: et('2026-10-03', '18:00'),
        duration: 120,
      }),
      // An untagged session on Sep 20 — a fix, earlier than the cancels.
      event({ id: 2, title: 'Community Night', tags: [], dateTime: et('2026-09-20', '20:00') }),
      // An odd capacity on Sep 26 — a notice.
      event({ id: 3, dateTime: et('2026-09-26', '20:00'), capacity: 3, spotsRemaining: 3 }),
    ];
    const report = runLint(feed, { now: NOW });
    expect(report.findings.map((f) => [f.rule, f.severity])).toEqual([
      ['special-event-overlap', 'cancel'],
      ['special-event-overlap', 'cancel'],
      ['untagged', 'fix'],
      ['capacity-outlier', 'notice'],
    ]);
    expect(countFindings(report.findings)).toEqual({
      byRule: { 'special-event-overlap': 2, untagged: 1, 'capacity-outlier': 1 },
      bySeverity: { cancel: 2, fix: 1, notice: 1 },
    });
  });

  it('gives the same digest whatever order the feed arrives in', () => {
    const feed = [
      ...cleanSchedule(),
      event({ id: 1, tags: ['Special Event'], dateTime: et('2026-10-03', '18:00'), duration: 120 }),
      event({ id: 2, tags: [], dateTime: et('2026-09-20', '20:00') }),
    ];
    const a = runLint(feed, { now: NOW }).digest;
    const b = runLint([...feed].reverse(), { now: NOW }).digest;
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });

  it('changes the digest when the list changes, not when it merely re-runs', () => {
    const base = [
      ...cleanSchedule(),
      event({ id: 2, tags: [], dateTime: et('2026-09-20', '20:00') }),
    ];
    const before = runLint(base, { now: NOW }).digest;
    const again = runLint(base, { now: new Date(NOW.getTime() + 3_600_000) }).digest;
    const fixed = runLint(cleanSchedule(), { now: NOW }).digest;
    const more = runLint(
      [...base, event({ id: 3, tags: [], dateTime: et('2026-09-21', '20:00') })],
      { now: NOW }
    ).digest;
    expect(again).toBe(before);
    expect(fixed).not.toBe(before);
    expect(more).not.toBe(before);
  });
});

describe('buildEmailProps', () => {
  it('groups overlaps by special event and splits the rest by severity', () => {
    const feed = [
      ...cleanSchedule(),
      event({
        id: 1,
        title: 'DJ Night',
        tags: ['Special Event'],
        dateTime: et('2026-10-03', '18:00'),
        duration: 120,
        link: 'https://momence.com/s/dj',
      }),
      event({ id: 4, title: 'Guided Heat', tags: ['Guided'], dateTime: et('2026-10-03', '19:00') }),
      event({ id: 2, title: 'Community Night', tags: [], dateTime: et('2026-09-20', '20:00') }),
      event({ id: 3, dateTime: et('2026-09-26', '20:00'), capacity: 3, spotsRemaining: 3 }),
    ];
    const props = buildEmailProps(runLint(feed, { now: NOW }));
    expect(props).toMatchObject({
      horizonLabel: 'Oct 12',
      cancelCount: 2,
      fixCount: 1,
      noticeCount: 2, // the odd capacity, plus the guided session marked review
    });
    expect(props.overlaps).toHaveLength(1);
    expect(props.overlaps[0]).toMatchObject({
      eventTitle: 'DJ Night',
      whenLabel: 'Sat, Oct 3 · 6:00 PM – 8:00 PM EDT',
      location: 'Pyre Sauna',
      link: 'https://momence.com/s/dj',
    });
    expect(props.overlaps[0].sessions.map((s) => [s.title, s.cancel])).toEqual([
      ['Open Hours', true],
      ['Open Hours', true],
      ['Guided Heat', false],
    ]);
    expect(props.fixes).toEqual([
      expect.objectContaining({
        session: expect.objectContaining({ title: 'Community Night', typeLabel: 'General' }),
      }),
    ]);
    expect(props.notices).toEqual([
      expect.objectContaining({
        message: 'Capacity 3; the other Open hours sessions of this length are 12',
        session: expect.objectContaining({ bookingLabel: 'No bookings' }),
      }),
    ]);
  });

  it('carries a schedule-wide notice without a session', () => {
    const props = buildEmailProps(runLint([], { now: NOW }));
    expect(props.notices).toEqual([
      { message: 'No Open Hours or Social sessions are published in the next four weeks' },
    ]);
    expect(props.noticeCount).toBe(1);
  });
});
