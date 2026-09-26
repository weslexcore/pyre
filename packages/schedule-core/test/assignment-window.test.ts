import { describe, expect, it } from 'vitest';
import { DEFAULT_SHIFT_BUFFERS, defaultAssignmentWindow } from '../src/assignment-window';

describe('defaultAssignmentWindow', () => {
  const evening = {
    starts_at: '14:30:00',
    ends_at: '20:30:00',
    sessions_start_at: '16:00:00',
    sessions_end_at: '20:00:00',
  };

  it('matches the shift window at the default 90/30 buffers', () => {
    expect(defaultAssignmentWindow(evening, DEFAULT_SHIFT_BUFFERS)).toEqual({
      startsAt: '14:30',
      endsAt: '20:30',
    });
  });

  it('counts the settings from the first and last session', () => {
    expect(defaultAssignmentWindow(evening, { arriveBeforeMin: 60, leaveAfterMin: 45 })).toEqual({
      startsAt: '15:00',
      endsAt: '20:45',
    });
  });

  it('keeps the shift window for a manual shift', () => {
    expect(
      defaultAssignmentWindow(
        { starts_at: '09:00:00', ends_at: '12:00:00', sessions_start_at: null, sessions_end_at: null },
        { arriveBeforeMin: 30, leaveAfterMin: 0 }
      )
    ).toEqual({ startsAt: '09:00', endsAt: '12:00' });
  });

  it('holds a split edge where it is', () => {
    // First half of a long day: arrives for the first session, leaves at the cut.
    expect(
      defaultAssignmentWindow(
        { starts_at: '05:00:00', ends_at: '12:30:00', sessions_start_at: '06:30:00', sessions_end_at: null },
        { arriveBeforeMin: 60, leaveAfterMin: 30 }
      )
    ).toEqual({ startsAt: '05:30', endsAt: '12:30' });
  });

  it('clamps at the day edges', () => {
    expect(
      defaultAssignmentWindow(
        { starts_at: '00:00:00', ends_at: '23:59:00', sessions_start_at: '00:30:00', sessions_end_at: '23:45:00' },
        { arriveBeforeMin: 90, leaveAfterMin: 30 }
      )
    ).toEqual({ startsAt: '00:00', endsAt: '23:59' });
  });
});
