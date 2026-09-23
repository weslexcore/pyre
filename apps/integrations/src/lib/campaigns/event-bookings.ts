import type { SessionBookingTotals } from '@/lib/momence/session-totals';

export const MAX_MEASUREMENT_SESSIONS = 50;

export function parseSessionIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_MEASUREMENT_SESSIONS) return null;
  if (
    value.some(
      (id) => typeof id !== 'string' || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))
    )
  )
    return null;
  return [...new Set(value)];
}

export interface EventBookings extends SessionBookingTotals {
  sessionId: string;
  generatedAt: string;
  cached: boolean;
}

export interface CombinedEventBookings extends SessionBookingTotals {
  sessions: EventBookings[];
  generatedAt: string;
  cached: boolean;
}

export function campaignEventId(campaign: {
  destinationKind: string;
  destinationValue: string;
}): string | null {
  if (campaign.destinationKind !== 'event') return null;
  return parseSessionIds([campaign.destinationValue.trim()])?.[0] ?? null;
}

export function campaignSessionIds(campaign: {
  destinationKind: string;
  destinationValue: string;
  measurementSessionIds?: string[];
}): string[] {
  if (campaign.measurementSessionIds !== undefined)
    return parseSessionIds(campaign.measurementSessionIds) ?? [];
  const id = campaignEventId(campaign);
  return id ? [id] : [];
}

export function combineEventBookings(sessions: EventBookings[]): CombinedEventBookings {
  const unique = [...new Map(sessions.map((session) => [session.sessionId, session])).values()];
  return {
    sessions: unique,
    bookings: unique.reduce((sum, session) => sum + session.bookings, 0),
    seats: unique.reduce((sum, session) => sum + session.seats, 0),
    cancelled: unique.reduce((sum, session) => sum + session.cancelled, 0),
    checkedIn: unique.reduce((sum, session) => sum + session.checkedIn, 0),
    generatedAt: unique.map((session) => session.generatedAt).sort()[0] ?? new Date().toISOString(),
    cached: unique.some((session) => session.cached),
  };
}
