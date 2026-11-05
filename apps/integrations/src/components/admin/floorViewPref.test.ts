// The saved Check Ins view comes back as saved, except a day or range that
// has wholly passed, which opens on the floor instead.
import { describe, expect, it } from 'vitest';
import { viewFromPref } from './floorViewPref';

// 2026-11-05 14:00 in New York (EST, so 19:00Z).
const NOW = Date.parse('2026-11-05T19:00:00Z');

describe('viewFromPref', () => {
  it('restores the saved view', () => {
    expect(viewFromPref({ view: 'next' }, NOW)).toEqual({ kind: 'next' });
    expect(viewFromPref({ view: 'day', date: '2026-11-05' }, NOW)).toEqual({
      kind: 'day',
      date: '2026-11-05',
    });
    expect(viewFromPref({ view: 'day', date: '2026-11-06' }, NOW)).toEqual({
      kind: 'day',
      date: '2026-11-06',
    });
    expect(
      viewFromPref(
        { view: 'custom', from: '2026-11-05T15:00:00.000Z', to: '2026-11-05T21:00:00.000Z' },
        NOW
      )
    ).toEqual({
      kind: 'custom',
      from: '2026-11-05T15:00:00.000Z',
      to: '2026-11-05T21:00:00.000Z',
    });
  });

  it('opens on the floor when nothing usable is saved', () => {
    expect(viewFromPref(null, NOW)).toEqual({ kind: 'floor' });
    expect(viewFromPref('next', NOW)).toEqual({ kind: 'floor' });
    expect(viewFromPref({ view: 'week' }, NOW)).toEqual({ kind: 'floor' });
    expect(viewFromPref({ view: 'day', date: 'yesterday' }, NOW)).toEqual({ kind: 'floor' });
  });

  it('drops a day or range that has already passed', () => {
    expect(viewFromPref({ view: 'day', date: '2026-11-04' }, NOW)).toEqual({ kind: 'floor' });
    expect(
      viewFromPref(
        { view: 'custom', from: '2026-11-05T10:00:00.000Z', to: '2026-11-05T14:00:00.000Z' },
        NOW
      )
    ).toEqual({ kind: 'floor' });
  });
});
