import { describe, expect, it } from 'vitest';
import { normalizeReport } from './normalize';

// 2026-08-10 is a Monday; 2026-08-17 the next.
const MON1 = '2026-08-10';
const MON2 = '2026-08-17';

describe('normalizeReport', () => {
  it('sums flow values into Monday-start weeks', () => {
    const result = normalizeReport(
      'TOTAL_SALES',
      [
        { saleDate: '2026-08-10', total: 100 },
        { saleDate: '2026-08-12', total: '50.25' }, // numeric string
        { saleDate: '2026-08-16T14:00:00Z', total: 10 }, // Sunday, same week
        { saleDate: '2026-08-17', total: 40 }, // next week
      ],
      MON2
    );
    expect(result.status).toBe('ok');
    expect(result.metrics).toEqual([
      { weekStart: MON1, metric: 'revenue_total', value: 160.25 },
      { weekStart: MON2, metric: 'revenue_total', value: 40 },
    ]);
  });

  it('buckets correctly across a month boundary', () => {
    const result = normalizeReport(
      'TOTAL_SALES',
      [
        { date: '2026-08-31', total: 5 }, // Monday
        { date: '2026-09-01', total: 7 }, // Tuesday, same week
      ],
      '2026-09-01'
    );
    expect(result.metrics).toEqual([
      { weekStart: '2026-08-31', metric: 'revenue_total', value: 12 },
    ]);
  });

  it('counts unparseable items without throwing and flags parse-partial', () => {
    const result = normalizeReport(
      'TOTAL_SALES',
      [
        { saleDate: '2026-08-10', total: 100 },
        { saleDate: '2026-08-11' }, // no value and no count fallback
        { total: 25 }, // no date
        'not-an-object',
        null,
      ],
      MON2
    );
    expect(result.parsed).toBe(1);
    expect(result.unparseable).toBe(4);
    expect(result.status).toBe('parse-partial');
    expect(result.metrics).toEqual([{ weekStart: MON1, metric: 'revenue_total', value: 100 }]);
  });

  it('falls back to counting rows for row-per-event reports', () => {
    const result = normalizeReport(
      'ATTENDANCE',
      [{ sessionDate: '2026-08-10' }, { sessionDate: '2026-08-11' }, { sessionDate: '2026-08-18' }],
      MON2
    );
    expect(result.status).toBe('ok');
    expect(result.metrics).toEqual([
      { weekStart: MON1, metric: 'attendance', value: 2 },
      { weekStart: MON2, metric: 'attendance', value: 1 },
    ]);
  });

  it('takes the latest reading per week for stock metrics', () => {
    const result = normalizeReport(
      'ACTIVE_MEMBERS',
      [
        { date: '2026-08-10', count: 90 },
        { date: '2026-08-14', count: 95 }, // later in same week wins
        { date: '2026-08-12', count: 80 },
      ],
      MON2
    );
    expect(result.metrics).toEqual([{ weekStart: MON1, metric: 'active_members', value: 95 }]);
  });

  it('anchors a date-less stock count to the snapshot week', () => {
    const result = normalizeReport('ACTIVE_MEMBERS', [{ count: 120 }], '2026-08-19');
    expect(result.metrics).toEqual([{ weekStart: MON2, metric: 'active_members', value: 120 }]);
  });

  it('computes occupancy as attendee-sum over capacity-sum, not mean of ratios', () => {
    const result = normalizeReport(
      'SESSION_OCCUPANCY',
      [
        { sessionDate: '2026-08-10', attendees: 10, capacity: 10 }, // 100%
        { sessionDate: '2026-08-11', attendees: 0, capacity: 30 }, // 0%
      ],
      MON2
    );
    // 10/40 = 25%, not the 50% a mean of percentages would give.
    expect(result.metrics).toEqual([{ weekStart: MON1, metric: 'occupancy_pct', value: 25 }]);
  });

  it('returns empty status for an empty report', () => {
    const result = normalizeReport('TOTAL_SALES', [], MON2);
    expect(result.status).toBe('empty');
    expect(result.metrics).toEqual([]);
  });

  it('produces no weekly metrics for snapshot-only report types', () => {
    const result = normalizeReport('REVENUE_BREAKDOWN', [{ category: 'x', total: 5 }], MON2);
    expect(result.metrics).toEqual([]);
    expect(result.status).toBe('ok');
  });
});
