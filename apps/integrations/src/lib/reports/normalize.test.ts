import { describe, expect, it } from 'vitest';
import { normalizeReport } from './normalize';

// 2026-08-10 is a Monday; 2026-08-17 the next.
const MON1 = '2026-08-10';
const MON2 = '2026-08-17';

/** A total-sales row, shaped like the ones the live API returns. */
const sale = (over: Record<string, unknown>) => ({
  paymentDate: '2026-08-10T15:00:00.000Z',
  paymentValue: 25.65,
  refunded: 0,
  paymentStatus: 'succeeded',
  paymentItem: 'Intro Buy One, Get One!',
  ...over,
});

describe('normalizeReport', () => {
  it('sums net revenue into Monday-start weeks', () => {
    const result = normalizeReport(
      'TOTAL_SALES',
      [
        sale({ paymentDate: '2026-08-10T15:00:00.000Z', paymentValue: 100 }),
        sale({ paymentDate: '2026-08-12T18:30:00.000Z', paymentValue: '50.25' }), // numeric string
        sale({ paymentDate: '2026-08-16T14:00:00.000Z', paymentValue: 10 }), // Sunday, same week
        sale({ paymentDate: '2026-08-17T14:00:00.000Z', paymentValue: 40 }), // next week
      ],
      MON2
    );
    expect(result.status).toBe('ok');
    expect(result.metrics).toEqual([
      { weekStart: MON1, metric: 'revenue_total', value: 160.25 },
      { weekStart: MON2, metric: 'revenue_total', value: 40 },
    ]);
  });

  it('subtracts refunds from the week they were charged in', () => {
    const result = normalizeReport(
      'TOTAL_SALES',
      [
        sale({ paymentValue: 100, refunded: 0 }),
        sale({ paymentValue: 25.65, refunded: 25.65 }), // fully refunded
        sale({ paymentValue: 40, refunded: 5.25 }), // partial
      ],
      MON1
    );
    expect(result.metrics).toEqual([
      { weekStart: MON1, metric: 'revenue_total', value: 134.75 },
    ]);
    expect(result.status).toBe('ok');
  });

  it('buckets by ET calendar day, not the UTC date in the timestamp', () => {
    // 2026-08-17T02:00Z is 10pm ET on Sunday 2026-08-16 — the *previous*
    // week. Slicing the ISO string would file it under MON2.
    const result = normalizeReport(
      'TOTAL_SALES',
      [sale({ paymentDate: '2026-08-17T02:00:00.000Z', paymentValue: 60 })],
      MON2
    );
    expect(result.metrics).toEqual([{ weekStart: MON1, metric: 'revenue_total', value: 60 }]);
  });

  it('buckets correctly across a month boundary', () => {
    const result = normalizeReport(
      'TOTAL_SALES',
      [
        sale({ paymentDate: '2026-08-31T16:00:00.000Z', paymentValue: 5 }), // Monday
        sale({ paymentDate: '2026-09-01T16:00:00.000Z', paymentValue: 7 }), // Tuesday, same week
      ],
      '2026-09-01'
    );
    expect(result.metrics).toEqual([
      { weekStart: '2026-08-31', metric: 'revenue_total', value: 12 },
    ]);
  });

  it('excludes payments that did not succeed without flagging parse-partial', () => {
    const result = normalizeReport(
      'TOTAL_SALES',
      [
        sale({ paymentValue: 100 }),
        sale({ paymentValue: 999, paymentStatus: 'failed' }),
        sale({ paymentValue: 999, paymentStatus: 'pending' }),
      ],
      MON1
    );
    expect(result.metrics).toEqual([{ weekStart: MON1, metric: 'revenue_total', value: 100 }]);
    expect(result.parsed).toBe(3);
    expect(result.unparseable).toBe(0);
    expect(result.status).toBe('ok');
  });

  it('counts unparseable items without throwing and flags parse-partial', () => {
    const result = normalizeReport(
      'TOTAL_SALES',
      [
        sale({ paymentValue: 100 }),
        sale({ paymentValue: null }), // no amount
        { paymentValue: 25 }, // no date
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

  it('accepts a bare wall-clock date as-is', () => {
    const result = normalizeReport(
      'TOTAL_SALES',
      [sale({ paymentDate: '2026-08-10', paymentValue: 12 })],
      MON1
    );
    expect(result.metrics).toEqual([{ weekStart: MON1, metric: 'revenue_total', value: 12 }]);
  });

  it('falls back to serviceDate when paymentDate is absent', () => {
    const result = normalizeReport(
      'TOTAL_SALES',
      [sale({ paymentDate: undefined, serviceDate: '2026-08-12T18:00:00.000Z', paymentValue: 30 })],
      MON1
    );
    expect(result.metrics).toEqual([{ weekStart: MON1, metric: 'revenue_total', value: 30 }]);
  });

  it('returns empty status for an empty report', () => {
    const result = normalizeReport('TOTAL_SALES', [], MON1);
    expect(result).toEqual({ metrics: [], parsed: 0, unparseable: 0, status: 'empty' });
  });
});
