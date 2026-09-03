import { describe, expect, it } from 'vitest';
import { formatChipDate, formatChipTime, isInSession, isUpcoming } from './next-shift';

const now = { date: '2026-08-31', minutes: 14 * 60 }; // Mon 2pm ET

describe('isUpcoming', () => {
  it('counts any future date', () => {
    expect(isUpcoming({ shift_date: '2026-09-01', ends_at: '10:00' }, now)).toBe(true);
  });

  it('drops past dates', () => {
    expect(isUpcoming({ shift_date: '2026-08-30', ends_at: '22:00' }, now)).toBe(false);
  });

  it("keeps today's shift until it ends (in progress counts)", () => {
    expect(isUpcoming({ shift_date: '2026-08-31', ends_at: '14:01' }, now)).toBe(true);
    expect(isUpcoming({ shift_date: '2026-08-31', ends_at: '22:00' }, now)).toBe(true);
  });

  it("drops today's shift once it has ended", () => {
    expect(isUpcoming({ shift_date: '2026-08-31', ends_at: '14:00' }, now)).toBe(false);
    expect(isUpcoming({ shift_date: '2026-08-31', ends_at: '09:00' }, now)).toBe(false);
  });
});

describe('isInSession', () => {
  it('is live when today and the window contains now', () => {
    expect(
      isInSession({ shift_date: '2026-08-31', starts_at: '12:00', ends_at: '16:00' }, now)
    ).toBe(true);
    // Starting exactly now counts as live.
    expect(
      isInSession({ shift_date: '2026-08-31', starts_at: '14:00', ends_at: '16:00' }, now)
    ).toBe(true);
  });

  it('is not live before it starts, once it ends, or on another day', () => {
    expect(
      isInSession({ shift_date: '2026-08-31', starts_at: '16:00', ends_at: '20:00' }, now)
    ).toBe(false);
    expect(
      isInSession({ shift_date: '2026-08-31', starts_at: '10:00', ends_at: '14:00' }, now)
    ).toBe(false);
    expect(
      isInSession({ shift_date: '2026-09-01', starts_at: '12:00', ends_at: '16:00' }, now)
    ).toBe(false);
  });
});

describe('formatChipTime', () => {
  it('renders the calendar shorthand', () => {
    expect(formatChipTime('16:00')).toBe('4p');
    expect(formatChipTime('09:30')).toBe('9:30a');
    expect(formatChipTime('12:00')).toBe('12p');
    expect(formatChipTime('00:15')).toBe('12:15a');
  });
});

describe('formatChipDate', () => {
  it('renders weekday plus short date', () => {
    expect(formatChipDate('2026-09-02')).toBe('Wed 9/2');
    expect(formatChipDate('2026-12-25')).toBe('Fri 12/25');
  });
});
