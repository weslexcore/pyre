import { describe, expect, it } from 'vitest';
import { normalizeReport } from './normalize';

// 2026-08-10 is a Monday; snapshot dates below are arbitrary valid days.
const SNAP = '2026-08-17';

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
  it('sums net revenue into ET calendar days', () => {
    const result = normalizeReport(
      'TOTAL_SALES',
      [
        sale({ paymentDate: '2026-08-10T15:00:00.000Z', paymentValue: 100 }),
        sale({ paymentDate: '2026-08-10T18:30:00.000Z', paymentValue: '50.25' }), // numeric string
        sale({ paymentDate: '2026-08-16T14:00:00.000Z', paymentValue: 10 }),
        sale({ paymentDate: '2026-08-17T14:00:00.000Z', paymentValue: 40 }),
      ],
      SNAP
    );
    expect(result.status).toBe('ok');
    expect(result.metrics).toEqual([
      { date: '2026-08-10', metric: 'revenue_total', value: 150.25 },
      { date: '2026-08-16', metric: 'revenue_total', value: 10 },
      { date: '2026-08-17', metric: 'revenue_total', value: 40 },
    ]);
  });

  it('subtracts refunds from the day they were charged on', () => {
    const result = normalizeReport(
      'TOTAL_SALES',
      [
        sale({ paymentValue: 100, refunded: 0 }),
        sale({ paymentValue: 25.65, refunded: 25.65 }), // fully refunded
        sale({ paymentValue: 40, refunded: 5.25 }), // partial
      ],
      SNAP
    );
    expect(result.metrics).toEqual([
      { date: '2026-08-10', metric: 'revenue_total', value: 134.75 },
    ]);
    expect(result.status).toBe('ok');
  });

  it('buckets by ET calendar day, not the UTC date in the timestamp', () => {
    // 2026-08-17T02:00Z is 10pm ET on Sunday 2026-08-16 — the *previous*
    // day. Slicing the ISO string would file it under the 17th.
    const result = normalizeReport(
      'TOTAL_SALES',
      [sale({ paymentDate: '2026-08-17T02:00:00.000Z', paymentValue: 60 })],
      SNAP
    );
    expect(result.metrics).toEqual([{ date: '2026-08-16', metric: 'revenue_total', value: 60 }]);
  });

  it('excludes payments that did not succeed without flagging parse-partial', () => {
    const result = normalizeReport(
      'TOTAL_SALES',
      [
        sale({ paymentValue: 100 }),
        sale({ paymentValue: 999, paymentStatus: 'failed' }),
        sale({ paymentValue: 999, paymentStatus: 'pending' }),
      ],
      SNAP
    );
    expect(result.metrics).toEqual([{ date: '2026-08-10', metric: 'revenue_total', value: 100 }]);
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
      SNAP
    );
    expect(result.parsed).toBe(1);
    expect(result.unparseable).toBe(4);
    expect(result.status).toBe('parse-partial');
    expect(result.metrics).toEqual([{ date: '2026-08-10', metric: 'revenue_total', value: 100 }]);
  });

  it('accepts a bare wall-clock date as-is', () => {
    const result = normalizeReport(
      'TOTAL_SALES',
      [sale({ paymentDate: '2026-08-10', paymentValue: 12 })],
      SNAP
    );
    expect(result.metrics).toEqual([{ date: '2026-08-10', metric: 'revenue_total', value: 12 }]);
  });

  it('falls back to serviceDate when paymentDate is absent', () => {
    const result = normalizeReport(
      'TOTAL_SALES',
      [sale({ paymentDate: undefined, serviceDate: '2026-08-12T18:00:00.000Z', paymentValue: 30 })],
      SNAP
    );
    expect(result.metrics).toEqual([{ date: '2026-08-12', metric: 'revenue_total', value: 30 }]);
  });

  it('returns empty status for an empty report', () => {
    const result = normalizeReport('TOTAL_SALES', [], SNAP);
    expect(result).toEqual({ metrics: [], parsed: 0, unparseable: 0, status: 'empty' });
  });
});
