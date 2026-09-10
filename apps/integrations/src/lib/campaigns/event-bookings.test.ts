import { describe, expect, it } from 'vitest';
import { campaignEventId, type EventBookings, eventBookingSummary } from './event-bookings';

const event = (over: Partial<EventBookings> = {}): EventBookings => ({
  sessionId: '9001',
  bookings: 45,
  cancelled: 0,
  seats: 47,
  checkedIn: 40,
  generatedAt: '2026-09-10T12:00:00.000Z',
  cached: false,
  ...over,
});

describe('campaignEventId', () => {
  it('takes the session id off an event campaign', () => {
    expect(campaignEventId({ destinationKind: 'event', destinationValue: ' 9001 ' })).toBe('9001');
  });

  it('has nothing to count for a campaign that opens something else', () => {
    expect(campaignEventId({ destinationKind: 'events', destinationValue: '' })).toBeNull();
    expect(campaignEventId({ destinationKind: 'blog', destinationValue: 'why-cold' })).toBeNull();
  });

  it('refuses a destination that is not a session id', () => {
    expect(campaignEventId({ destinationKind: 'event', destinationValue: 'winter' })).toBeNull();
  });
});

describe('eventBookingSummary', () => {
  it('splits the event total into attributed and everything else', () => {
    expect(eventBookingSummary(event(), 12)).toBe(
      'Momence has 45 bookings for this event. 12 attributed to this campaign, 33 from elsewhere.'
    );
  });

  it('claims only the total while the campaign report is still loading', () => {
    expect(eventBookingSummary(event(), null)).toBe('Momence has 45 bookings for this event.');
  });

  it('says where cancelled bookings went', () => {
    expect(eventBookingSummary(event({ cancelled: 1 }), 12)).toContain(
      '(1 cancelled booking not counted)'
    );
  });

  it('explains an attributed count larger than the event took', () => {
    expect(eventBookingSummary(event({ bookings: 3 }), 5)).toContain(
      'more than the event took, so some are for other sessions'
    );
  });

  it('reads a session nobody booked', () => {
    expect(eventBookingSummary(event({ bookings: 0 }), 0)).toBe(
      'Momence has 0 bookings for this event. 0 attributed to this campaign, 0 from elsewhere.'
    );
  });
});
