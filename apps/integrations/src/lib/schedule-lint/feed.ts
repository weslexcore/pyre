// One pass over the Momence v1 events feed that every rule shares: instants
// resolved, tags cleaned, the horizon applied. Rules receive the normalised
// rows and never touch the raw feed, so a feed field that moves or vanishes
// is handled here once.

import { addDays, easternToUtc, utcToEastern } from '@pyre/schedule-core';
import { type MomenceEvent, SPECIAL_EVENT_TYPE, sessionTypeForTags } from '@/lib/momence-events';
import { HORIZON_DAYS, type SessionRef } from './types';

export interface NormalizedSession {
  event: MomenceEvent;
  id: number;
  title: string;
  /** ms since epoch */
  start: number;
  end: number;
  durationMinutes: number;
  tags: string[];
  type: string;
  isSpecialEvent: boolean;
  /** The v1 feed only marks drafts with `published: false`; absent means live. */
  isPublished: boolean;
  location: string | null;
  bookingCount: number | null;
  capacity: number | null;
  link: string | null;
}

export interface FeedWindow {
  now: Date;
  /** ET calendar days ahead to scan; defaults to HORIZON_DAYS. */
  horizonDays?: number;
}

export const norm = (value: string): string => value.trim().toLowerCase();

/**
 * Explicit membership test, not sessionTypeForTags(): that helper returns
 * the FIRST recognised tag, so a DJ night tagged ['Social', 'Special Event']
 * would come back 'social' and end up on the wrong side of the check.
 */
export function isSpecialEvent(tags: string[] | undefined): boolean {
  return (tags ?? []).some((tag) => norm(tag) === SPECIAL_EVENT_TYPE);
}

/** Seats taken, from whichever counters the feed carries; null when it carries none. */
export function bookingCountOf(event: MomenceEvent): number | null {
  const { capacity, spotsRemaining, ticketsSold } = event;
  if (
    typeof capacity === 'number' &&
    typeof spotsRemaining === 'number' &&
    Number.isFinite(capacity) &&
    Number.isFinite(spotsRemaining) &&
    capacity >= 0 &&
    spotsRemaining >= 0
  ) {
    return Math.max(0, capacity - spotsRemaining);
  }
  if (typeof ticketsSold === 'number' && Number.isFinite(ticketsSold)) {
    return Math.max(0, ticketsSold);
  }
  return null;
}

/**
 * Same room? Pyre has one venue, so a blank location on either side is
 * treated as "here" — an unfilled field must never hide a problem.
 */
export function sameLocation(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a?.trim() || !b?.trim()) return true;
  return norm(a) === norm(b);
}

/** The ET calendar window a run covers. */
export function horizonOf({ now, horizonDays = HORIZON_DAYS }: FeedWindow): {
  start: string;
  end: string;
  /** ms since epoch, exclusive. */
  endMs: number;
} {
  const start = utcToEastern(now.toISOString()).date;
  const end = addDays(start, horizonDays);
  return { start, end, endMs: Date.parse(easternToUtc(end, '00:00')) };
}

/**
 * Every well-formed, not-yet-over row inside the horizon — drafts included,
 * cancelled and deleted rows dropped. Rules decide what to do with drafts.
 */
export function normalizeFeed(events: MomenceEvent[], window: FeedWindow): NormalizedSession[] {
  const nowMs = window.now.getTime();
  const { endMs } = horizonOf(window);
  const rows: NormalizedSession[] = [];
  for (const event of events) {
    const start = Date.parse(event.dateTime);
    if (!Number.isFinite(start)) continue;
    if (typeof event.duration !== 'number' || !(event.duration > 0)) continue;
    if (event.isCancelled || event.isDeleted) continue;
    const end = start + event.duration * 60_000;
    if (end <= nowMs) continue; // already over
    if (start >= endMs) continue; // beyond what we scan
    const tags = Array.isArray(event.tags)
      ? event.tags.filter((t): t is string => typeof t === 'string')
      : [];
    rows.push({
      event,
      id: Number(event.id),
      title: event.title,
      start,
      end,
      durationMinutes: event.duration,
      tags,
      type: sessionTypeForTags(tags),
      isSpecialEvent: isSpecialEvent(tags),
      isPublished: event.published !== false,
      location: event.location?.trim() || null,
      bookingCount: bookingCountOf(event),
      capacity:
        typeof event.capacity === 'number' && Number.isFinite(event.capacity)
          ? event.capacity
          : null,
      link: event.link?.trim() || null,
    });
  }
  return rows;
}

export function toRef(row: NormalizedSession): SessionRef {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    startsAt: new Date(row.start).toISOString(),
    endsAt: new Date(row.end).toISOString(),
    location: row.location,
    bookingCount: row.bookingCount,
    capacity: row.capacity,
    link: row.link,
  };
}
