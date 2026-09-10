import { describe, expect, it } from 'vitest';
import type { SessionBooking } from '@/lib/momence/host-api';
import { summarizeSessionBookings } from './session-totals';

const booking = (over: Partial<SessionBooking> = {}): SessionBooking => ({
  id: 1,
  checkedIn: false,
  ticketsBought: 1,
  cancelledAt: null,
  ...over,
});

describe('summarizeSessionBookings', () => {
  it('counts live bookings and leaves cancelled ones out of the total', () => {
    const totals = summarizeSessionBookings([
      booking({ id: 1 }),
      booking({ id: 2, cancelledAt: '2026-09-01T12:00:00.000Z' }),
      booking({ id: 3, checkedIn: true }),
    ]);
    expect(totals).toEqual({ bookings: 2, cancelled: 1, seats: 2, checkedIn: 1 });
  });

  it('counts a multi-ticket booking once but as several seats', () => {
    const totals = summarizeSessionBookings([booking({ ticketsBought: 3 })]);
    expect(totals.bookings).toBe(1);
    expect(totals.seats).toBe(3);
  });

  it('treats a booking with no ticket count as one seat', () => {
    const totals = summarizeSessionBookings([
      booking({ ticketsBought: undefined as unknown as number }),
    ]);
    expect(totals.seats).toBe(1);
  });

  it('reads an empty list as an empty session', () => {
    expect(summarizeSessionBookings([])).toEqual({
      bookings: 0,
      cancelled: 0,
      seats: 0,
      checkedIn: 0,
    });
  });
});
