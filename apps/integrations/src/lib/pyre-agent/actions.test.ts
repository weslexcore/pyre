import { describe, expect, it, vi } from 'vitest';

vi.mock('@pyre/schedule-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pyre/schedule-core')>()),
  todayEastern: () => '2026-10-16',
}));
vi.mock('@/lib/db', () => ({ getDb: () => null }));

const { firstDueDate, repeatInput } = await import('./actions');

describe('repeatInput', () => {
  it('takes a rule, null to stop repeating, or nothing', () => {
    expect(repeatInput({ every: 2, unit: 'week' }, 'repeat')).toEqual({
      ok: true,
      value: { every: 2, unit: 'week' },
    });
    expect(repeatInput({ unit: 'month' }, 'repeat')).toEqual({
      ok: true,
      value: { every: 1, unit: 'month' },
    });
    expect(repeatInput(null, 'repeat')).toEqual({ ok: true, value: null });
    expect(repeatInput(undefined, 'repeat')).toEqual({ ok: true, value: undefined });
  });

  it('refuses a unit the board does not know or an interval out of range', () => {
    expect(repeatInput({ every: 1, unit: 'hour' }, 'repeat').ok).toBe(false);
    expect(repeatInput({ every: 0, unit: 'day' }, 'repeat').ok).toBe(false);
    expect(repeatInput({ every: 1.5, unit: 'day' }, 'cards[0].repeat')).toMatchObject({
      ok: false,
      error: expect.stringContaining('cards[0].repeat'),
    });
  });
});

describe('firstDueDate', () => {
  it('starts an undated recurring card today, and leaves everything else alone', () => {
    expect(firstDueDate(undefined, { every: 1, unit: 'week' })).toBe('2026-10-16');
    expect(firstDueDate('2026-10-24', { every: 1, unit: 'week' })).toBe('2026-10-24');
    expect(firstDueDate(undefined, undefined)).toBeNull();
    expect(firstDueDate(null, null)).toBeNull();
  });
});
