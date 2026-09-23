import { describe, expect, it } from 'vitest';
import { summarizeSessionBookings } from '@/lib/momence/session-totals';
import {
  campaignSessionIds,
  combineEventBookings,
  type EventBookings,
  parseSessionIds,
} from './event-bookings';

const legacy = { destinationKind: 'event', destinationValue: '9001' };
describe('measurement selection', () => {
  it('defaults legacy campaigns to their event, but respects an explicit empty selection', () => {
    expect(campaignSessionIds(legacy)).toEqual(['9001']);
    expect(campaignSessionIds({ ...legacy, measurementSessionIds: [] })).toEqual([]);
    expect(campaignSessionIds({ destinationKind: 'home', destinationValue: '' })).toEqual([]);
  });
  it('keeps measurement independent of destination and removes duplicates', () => {
    expect(campaignSessionIds({ ...legacy, measurementSessionIds: ['2', '3', '2'] })).toEqual([
      '2',
      '3',
    ]);
  });
  it('rejects invalid IDs and oversized selections', () => {
    for (const value of [
      ['0'],
      ['-2'],
      ['01'],
      ['1.2'],
      ['9007199254740992'],
      [2],
      null,
      Array(51).fill('1'),
    ])
      expect(parseSessionIds(value)).toBeNull();
  });
});
describe('combined totals', () => {
  it('sums six overlapping slot choices without expanding durations or deduplicating people', () => {
    const sessions: EventBookings[] = Array.from({ length: 6 }, (_, index) => ({
      sessionId: String(index + 1),
      ...summarizeSessionBookings([
        { id: index * 3 + 1, checkedIn: true, ticketsBought: 2, cancelledAt: null },
        { id: index * 3 + 2, checkedIn: false, ticketsBought: 1, cancelledAt: null },
        { id: index * 3 + 3, checkedIn: true, ticketsBought: 3, cancelledAt: '2026-09-01' },
      ]),
      generatedAt: '2026-09-23T12:00:00Z',
      cached: index === 0,
    }));
    expect(combineEventBookings([...sessions, sessions[0]])).toMatchObject({
      bookings: 12,
      seats: 18,
      cancelled: 6,
      checkedIn: 6,
      cached: true,
    });
    expect(combineEventBookings(sessions).sessions).toHaveLength(6);
  });
});
