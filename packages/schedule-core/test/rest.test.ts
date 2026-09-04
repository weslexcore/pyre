// The rest rule: an evening close followed by an opening the next day is a
// violation; anything else — same-day pairs, a day between, a setup hour that
// ends early, an afternoon start — is not.

import { describe, expect, it } from 'vitest';
import {
  EVENING_SHIFT_ENDS_MIN,
  findRestViolations,
  isEveningAssignment,
  isOpeningAssignment,
  OPENING_SHIFT_STARTS_MIN,
} from '../src/rest';

const on = (staffId: string, date: string, startsAt: string, endsAt: string) => ({
  staffId,
  date,
  startsAt,
  endsAt,
});

describe('thresholds', () => {
  it('reads an evening off the end time and an opening off the start', () => {
    expect(EVENING_SHIFT_ENDS_MIN).toBe(19 * 60);
    expect(OPENING_SHIFT_STARTS_MIN).toBe(11 * 60);
    expect(isEveningAssignment('20:30:00')).toBe(true);
    expect(isEveningAssignment('19:00')).toBe(true);
    expect(isEveningAssignment('18:30')).toBe(false);
    expect(isOpeningAssignment('05:00:00')).toBe(true);
    expect(isOpeningAssignment('10:59')).toBe(true);
    expect(isOpeningAssignment('11:00')).toBe(false);
  });
});

describe('findRestViolations', () => {
  it('flags an evening close followed by the next morning open', () => {
    const evening = on('sam', '2026-09-07', '14:30', '20:30');
    const opening = on('sam', '2026-09-08', '05:00', '10:00');
    expect(findRestViolations([opening, evening])).toEqual([{ staffId: 'sam', evening, opening }]);
  });

  it('ignores other people, other days, and same-day pairs', () => {
    expect(
      findRestViolations([
        on('sam', '2026-09-07', '14:30', '20:30'),
        on('ana', '2026-09-08', '05:00', '10:00'), // someone else opens
        on('sam', '2026-09-09', '05:00', '10:00'), // a day of rest between
        on('sam', '2026-09-07', '05:00', '10:00'), // opened the same day, not the next
      ])
    ).toEqual([]);
  });

  it('judges the person\'s own hours, not the shift window', () => {
    // A setup hour on the evening shift ends at 16:30 — not a close.
    expect(
      findRestViolations([
        on('sam', '2026-09-07', '14:30', '16:30'),
        on('sam', '2026-09-08', '05:00', '10:00'),
      ])
    ).toEqual([]);
    // An afternoon start the day after a close is fine.
    expect(
      findRestViolations([
        on('sam', '2026-09-07', '14:30', '20:30'),
        on('sam', '2026-09-08', '11:30', '16:30'),
      ])
    ).toEqual([]);
  });

  it('crosses a month boundary and reports every opening that follows', () => {
    const evening = on('sam', '2026-09-30', '14:30', '20:30');
    const a = on('sam', '2026-10-01', '05:00', '08:00');
    const b = on('sam', '2026-10-01', '08:30', '10:30');
    expect(findRestViolations([evening, a, b]).map((v) => v.opening)).toEqual([a, b]);
  });
});
