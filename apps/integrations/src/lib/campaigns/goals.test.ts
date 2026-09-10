import { parseGoals } from '@pyre/webhook-core';
import { describe, expect, it } from 'vitest';
import { elapsedFraction, GOAL_METRICS, goalProgress, goalWindow, measurementsOf } from './goals';

const today = '2026-09-15';

/** A ten-day run, September 10 through 19, with today the sixth day. */
const run = { startsAt: '2026-09-10', endsAt: '2026-09-19' };

describe('elapsedFraction', () => {
  it('counts both ends of the run as days', () => {
    // Day 6 of 10.
    expect(elapsedFraction(run, today)).toBeCloseTo(0.6);
    expect(elapsedFraction({ startsAt: today, endsAt: today }, today)).toBe(1);
  });

  it('clamps outside the run and needs both dates', () => {
    expect(elapsedFraction(run, '2026-09-01')).toBe(0);
    expect(elapsedFraction(run, '2026-12-01')).toBe(1);
    expect(elapsedFraction({ startsAt: '2026-09-10', endsAt: '' }, today)).toBeNull();
    expect(elapsedFraction({ startsAt: '', endsAt: '2026-09-19' }, today)).toBeNull();
  });
});

describe('goalProgress', () => {
  const goal = { metric: 'bookings' as const, target: 100 };

  it('reads a met goal as hit whatever the pace', () => {
    const progress = goalProgress(goal, { value: 100, phase: 'live', elapsed: 0.1 });
    expect(progress.state).toBe('hit');
    expect(progress.pct).toBe(1);
  });

  it('judges a running campaign against the pace its dates imply', () => {
    const at = (value: number) => goalProgress(goal, { value, phase: 'live', elapsed: 0.6 }).state;
    // 60 is exactly on pace at 60% elapsed; 45 is 75% of that.
    expect(at(70)).toBe('ahead');
    expect(at(60)).toBe('on-track');
    expect(at(45)).toBe('on-track');
    expect(at(44)).toBe('behind');
    expect(goalProgress(goal, { value: 44, phase: 'live', elapsed: 0.6 }).expected).toBe(60);
  });

  it('has no pace to judge without both dates', () => {
    const progress = goalProgress(goal, { value: 3, phase: 'live', elapsed: null });
    expect(progress.state).toBe('running');
    expect(progress.expected).toBeNull();
  });

  it('calls a short campaign missed once it is over', () => {
    expect(goalProgress(goal, { value: 99, phase: 'ended', elapsed: 1 }).state).toBe('missed');
    expect(goalProgress(goal, { value: 99, phase: 'archived', elapsed: 1 }).state).toBe('missed');
    expect(goalProgress(goal, { value: 100, phase: 'ended', elapsed: 1 }).state).toBe('hit');
  });

  it('says untracked rather than behind when the metric has no data source', () => {
    const progress = goalProgress(goal, {
      value: 0,
      phase: 'ended',
      elapsed: 1,
      tracked: false,
    });
    expect(progress.state).toBe('untracked');
  });
});

describe('goalWindow', () => {
  const createdAt = Date.parse('2026-09-14T12:00:00Z');

  it('picks the shortest window that reaches the start of the run', () => {
    expect(goalWindow({ startsAt: '2026-09-10', createdAt }, today).days).toBe(7);
    expect(goalWindow({ startsAt: '2026-08-20', createdAt }, today).days).toBe(30);
    expect(goalWindow({ startsAt: '2026-07-01', createdAt }, today).days).toBe(90);
  });

  it('falls back to the day the campaign was created', () => {
    expect(goalWindow({ startsAt: '', createdAt }, today).days).toBe(7);
  });

  it('flags a run the longest window cannot cover', () => {
    expect(goalWindow({ startsAt: '2026-01-01', createdAt }, today)).toEqual({
      days: 90,
      coversRun: false,
    });
  });
});

describe('measurementsOf', () => {
  it('maps every goal metric to a number on the report row', () => {
    const measurements = measurementsOf({
      shortlinkClicks: 1,
      visitors: 2,
      mailingListSignups: 3,
      introOfferSignups: 4,
      bookings: 5,
      introPurchases: 6,
      creditPacks: 7,
      memberships: 8,
    });
    for (const metric of GOAL_METRICS) {
      expect(typeof measurements[metric.key]).toBe('number');
    }
    expect(measurements.clicks).toBe(1);
    expect(measurements.memberships).toBe(8);
  });
});

// Goals ride the campaign hash as one JSON field, and Upstash hands JSON-looking
// values back already parsed — so the store has to read both shapes.
describe('parseGoals (store read path)', () => {
  const goals = [{ metric: 'bookings', target: 25 }];

  it('reads goals written as JSON and as an array', () => {
    expect(parseGoals(JSON.stringify(goals))).toEqual(goals);
    expect(parseGoals(goals)).toEqual(goals);
  });

  it('reads a campaign with no goals, or a mangled field, as none', () => {
    expect(parseGoals(undefined)).toEqual([]);
    expect(parseGoals('')).toEqual([]);
    expect(parseGoals('not json')).toEqual([]);
    expect(parseGoals('{"metric":"bookings"}')).toEqual([]);
  });

  it('drops entries the form would never have produced', () => {
    expect(
      parseGoals([
        { metric: 'vibes', target: 3 },
        { metric: 'bookings', target: 0 },
        { metric: 'bookings', target: 4 },
        { metric: 'bookings', target: 9 },
        null,
      ])
    ).toEqual([{ metric: 'bookings', target: 4 }]);
  });
});
