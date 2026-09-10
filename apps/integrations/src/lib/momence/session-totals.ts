// How many bookings a single Momence session actually has.
//
// The campaign report counts bookings PostHog can attribute to a campaign.
// That is always a subset: someone who books an event after seeing the flyer
// but never touching a tracked link is invisible to it. For a campaign built
// around one event, the honest denominator is Momence's own booking list for
// that session, which is what this reads.
//
// Momence has no "one session" endpoint on the host API, but the session's
// booking list is a single (paginated) call, and counting it matches the
// `bookingCount` the sessions feed reports for the same session.

import { fetchSessionBookings, type SessionBooking } from '@/lib/momence/host-api';

export interface SessionBookingTotals {
  /** Live bookings — cancelled seats dropped. The unit `booking_completed`
   * counts in, so it is directly comparable to the attributed number. */
  bookings: number;
  /** Withdrawn bookings, kept for context rather than counted. */
  cancelled: number;
  /** Seats across the live bookings: one booking can buy several tickets. */
  seats: number;
  /** Live bookings that were checked in. */
  checkedIn: number;
}

/** Pure counting half, so the shapes Momence returns can be tested directly. */
export function summarizeSessionBookings(rows: SessionBooking[]): SessionBookingTotals {
  const totals: SessionBookingTotals = { bookings: 0, cancelled: 0, seats: 0, checkedIn: 0 };
  for (const row of rows) {
    if (row.cancelledAt) {
      totals.cancelled += 1;
      continue;
    }
    totals.bookings += 1;
    // `ticketsBought` is 1 on an ordinary seat; guard the shapes where it is
    // missing so a session never reads as zero seats.
    totals.seats += Number(row.ticketsBought) > 0 ? Number(row.ticketsBought) : 1;
    if (row.checkedIn) totals.checkedIn += 1;
  }
  return totals;
}

/** Every booking on one session, counted. One Momence call (plus paging). */
export async function fetchSessionBookingTotals(sessionId: number): Promise<SessionBookingTotals> {
  return summarizeSessionBookings(await fetchSessionBookings(sessionId));
}
