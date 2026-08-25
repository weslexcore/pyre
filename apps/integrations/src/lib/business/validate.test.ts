import { describe, expect, it } from 'vitest';
import { parseCostInput } from './validate';

const ok = (body: Record<string, unknown>) => {
  const result = parseCostInput(body);
  if ('error' in result) throw new Error(`expected valid input, got: ${result.error}`);
  return result.record;
};

const err = (body: Record<string, unknown>): string => {
  const result = parseCostInput(body);
  if (!('error' in result)) throw new Error('expected an error');
  return result.error;
};

describe('parseCostInput', () => {
  it('accepts a monthly subscription', () => {
    const record = ok({
      name: 'Mailchimp',
      category: 'software',
      kind: 'recurring',
      amount: 60,
      cadence: 'monthly',
      effectiveFrom: '2026-08-01',
    });
    expect(record).toMatchObject({
      name: 'Mailchimp',
      kind: 'recurring',
      cadence: 'monthly',
      amount: 60,
      effective_from: '2026-08-01',
      effective_to: null,
      monthly_cap: null,
      incurred_on: null,
    });
  });

  it('accepts capped per-open-hour rent', () => {
    const record = ok({
      name: 'Rent',
      category: 'rent',
      kind: 'per_open_hour',
      amount: 50,
      monthlyCap: 4250,
    });
    expect(record.monthly_cap).toBe(4250);
    expect(record.cadence).toBeNull();
  });

  it('accepts a one-off purchase with its date', () => {
    const record = ok({
      name: 'Firewood cord',
      category: 'supplies',
      kind: 'one_off',
      amount: 475,
      incurredOn: '2026-08-12',
    });
    expect(record.incurred_on).toBe('2026-08-12');
  });

  it('requires a cadence on recurring costs', () => {
    expect(err({ name: 'X', category: 'software', kind: 'recurring', amount: 10 })).toContain(
      'cadence'
    );
  });

  it('requires incurredOn on one-off costs', () => {
    expect(err({ name: 'X', category: 'supplies', kind: 'one_off', amount: 10 })).toContain(
      'incurredOn'
    );
  });

  it('rejects columns that do not belong to the kind', () => {
    expect(
      err({ name: 'X', category: 'fees', kind: 'percent_of_revenue', amount: 3, monthlyCap: 100 })
    ).toContain('monthlyCap');
    expect(
      err({
        name: 'X',
        category: 'software',
        kind: 'one_off',
        amount: 3,
        incurredOn: '2026-08-01',
        effectiveFrom: '2026-08-01',
      })
    ).toContain('effective');
    expect(
      err({ name: 'X', category: 'rent', kind: 'per_open_hour', amount: 50, cadence: 'monthly' })
    ).toContain('cadence');
  });

  it('bounds percent_of_revenue at 100', () => {
    expect(err({ name: 'X', category: 'fees', kind: 'percent_of_revenue', amount: 250 })).toContain(
      'percentage'
    );
  });

  it('rejects a backwards effective window', () => {
    expect(
      err({
        name: 'X',
        category: 'software',
        kind: 'recurring',
        amount: 10,
        cadence: 'monthly',
        effectiveFrom: '2026-08-10',
        effectiveTo: '2026-08-01',
      })
    ).toContain('effectiveTo');
  });

  it('rejects bad amounts and blank names', () => {
    expect(
      err({ name: '  ', category: 'other', kind: 'one_off', amount: 5, incurredOn: '2026-08-01' })
    ).toContain('name');
    expect(
      err({ name: 'X', category: 'other', kind: 'one_off', amount: 0, incurredOn: '2026-08-01' })
    ).toContain('amount');
    expect(
      err({
        name: 'X',
        category: 'other',
        kind: 'one_off',
        amount: Number.NaN,
        incurredOn: '2026-08-01',
      })
    ).toContain('amount');
  });
});
