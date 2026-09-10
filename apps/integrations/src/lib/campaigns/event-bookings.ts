// The event-side half of a campaign's bookings: what Momence says the event
// took in total, said in a sentence next to what the campaign can claim.
//
// Client-bundle-safe (no store imports) — the performance panel renders it.

/** Momence's own booking count for the event a campaign points at, as
 * /api/admin/event-bookings returns it. */
export interface EventBookings {
  sessionId: string;
  /** Live bookings, cancelled seats dropped. */
  bookings: number;
  cancelled: number;
  seats: number;
  checkedIn: number;
  generatedAt: string;
  cached: boolean;
}

/** The Momence session id a campaign's destination names, or null when its
 * links do not open one event (a blog post, the whole schedule, elsewhere). */
export function campaignEventId(campaign: {
  destinationKind: string;
  destinationValue: string;
}): string | null {
  if (campaign.destinationKind !== 'event') return null;
  const value = campaign.destinationValue.trim();
  return /^\d+$/.test(value) ? value : null;
}

/**
 * "Momence has 45 bookings for this event. 12 attributed to this campaign, 33
 * from elsewhere." — `attributed` is null while the campaign report is still
 * loading, in which case only the total is claimed.
 *
 * Attributed bookings can outrun the event's total: a booking attributed to
 * this campaign may be for another session entirely (someone follows a flyer's
 * link and books a different night). Saying so beats printing a remainder
 * below zero.
 */
export function eventBookingSummary(event: EventBookings, attributed: number | null): string {
  const total = event.bookings;
  const cancelled =
    event.cancelled > 0
      ? ` (${event.cancelled} cancelled booking${event.cancelled === 1 ? '' : 's'} not counted)`
      : '';
  const head = `Momence has ${total} booking${total === 1 ? '' : 's'} for this event${cancelled}.`;
  if (attributed === null) return head;
  if (attributed > total) {
    return `${head} ${attributed} bookings are attributed to this campaign — more than the event took, so some are for other sessions.`;
  }
  return `${head} ${attributed} attributed to this campaign, ${total - attributed} from elsewhere.`;
}
