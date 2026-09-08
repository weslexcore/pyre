// The overlap detector: given the Momence events feed, which regular sessions
// are sitting under a special event? Pure — no I/O, no clock of its own — so
// every edge case (touching intervals, multi-day events, a slot under two
// events, the tag-order trap) is a unit test rather than a Monday surprise.

import { addDays, easternToUtc, utcToEastern } from '@pyre/schedule-core';
import { type MomenceEvent, SPECIAL_EVENT_TYPE, sessionTypeForTags } from '@/lib/momence-events';
import {
  type ConflictSession,
  HORIZON_DAYS,
  isHandled,
  PRESELECT_TYPES,
  type Resolution,
  type ResolutionEntry,
  type ReviewStatus,
  type SessionConflict,
} from './types';

export interface DetectOptions {
  now: Date;
  /** ET calendar days ahead to scan; defaults to HORIZON_DAYS. */
  horizonDays?: number;
}

/** A feed row with its instants resolved, ready for interval math. */
interface Normalized {
  event: MomenceEvent;
  id: number;
  start: number;
  end: number;
  tags: string[];
}

const norm = (value: string): string => value.trim().toLowerCase();

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

/** The first recognised, non-special tag in its original spelling. */
function recognisedTag(tags: string[]): string | null {
  for (const tag of tags) {
    if (norm(tag) === SPECIAL_EVENT_TYPE) continue;
    if (sessionTypeForTags([tag]) !== sessionTypeForTags(undefined)) return tag.trim();
  }
  return null;
}

/**
 * Strict overlap — touching intervals (one ends exactly when the other
 * starts) are not conflicts. Sessions at Pyre are booked back to back.
 */
export function overlaps(a: { start: number; end: number }, b: { start: number; end: number }) {
  return a.start < b.end && a.end > b.start;
}

/**
 * Same room? Pyre has one venue, so a blank location on either side is
 * treated as "here" — an unfilled field must never hide a conflict.
 */
function sameLocation(a: string | undefined, b: string | undefined): boolean {
  if (!a?.trim() || !b?.trim()) return true;
  return norm(a) === norm(b);
}

function normalize(event: MomenceEvent, now: number, horizonEnd: number): Normalized | null {
  const start = Date.parse(event.dateTime);
  if (!Number.isFinite(start)) return null;
  if (typeof event.duration !== 'number' || !(event.duration > 0)) return null;
  if (event.isCancelled || event.isDeleted || event.published === false) return null;
  const end = start + event.duration * 60_000;
  if (end <= now) return null; // already over
  if (start >= horizonEnd) return null; // beyond what we scan
  return {
    event,
    id: Number(event.id),
    start,
    end,
    tags: Array.isArray(event.tags) ? event.tags.filter((t) => typeof t === 'string') : [],
  };
}

function toSession(row: Normalized): ConflictSession {
  const type = sessionTypeForTags(row.tags);
  return {
    id: row.id,
    title: row.event.title,
    tag: recognisedTag(row.tags),
    type,
    startsAt: new Date(row.start).toISOString(),
    endsAt: new Date(row.end).toISOString(),
    location: row.event.location?.trim() || null,
    bookingCount: bookingCountOf(row.event),
    capacity:
      typeof row.event.capacity === 'number' && Number.isFinite(row.event.capacity)
        ? row.event.capacity
        : null,
    link: row.event.link?.trim() || null,
    preselected: PRESELECT_TYPES.includes(type),
  };
}

/**
 * Every special event in the window with the regular sessions overlapping
 * it. Groups are ordered by the special event's start; sessions by start,
 * then shortest first (an hour slot before the 2h partner sharing its
 * start), then id. A session under two special events appears in both
 * groups — uniqueSessionIds() is the de-duplicated view.
 */
export function findSessionConflicts(
  events: MomenceEvent[],
  { now, horizonDays = HORIZON_DAYS }: DetectOptions
): SessionConflict[] {
  const nowMs = now.getTime();
  const today = utcToEastern(now.toISOString()).date;
  const horizonEnd = Date.parse(easternToUtc(addDays(today, horizonDays), '00:00'));

  const rows: Normalized[] = [];
  for (const event of events) {
    const row = normalize(event, nowMs, horizonEnd);
    if (row) rows.push(row);
  }

  const specials = rows.filter((r) => isSpecialEvent(r.tags));
  const candidates = rows.filter((r) => !isSpecialEvent(r.tags));

  const conflicts: SessionConflict[] = [];
  for (const special of specials) {
    const under = candidates.filter(
      (c) => overlaps(c, special) && sameLocation(c.event.location, special.event.location)
    );
    if (under.length === 0) continue;

    under.sort((a, b) => a.start - b.start || a.end - a.start - (b.end - b.start) || a.id - b.id);

    conflicts.push({
      specialEvent: {
        id: special.id,
        title: special.event.title,
        startsAt: new Date(special.start).toISOString(),
        endsAt: new Date(special.end).toISOString(),
        location: special.event.location?.trim() || null,
        link: special.event.link?.trim() || null,
      },
      sessions: under.map(toSession),
    });
  }

  conflicts.sort(
    (a, b) =>
      Date.parse(a.specialEvent.startsAt) - Date.parse(b.specialEvent.startsAt) ||
      a.specialEvent.id - b.specialEvent.id
  );
  return conflicts;
}

/** Distinct session ids across every group, in first-seen order. */
export function uniqueSessionIds(conflicts: SessionConflict[]): number[] {
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const group of conflicts) {
    for (const session of group.sessions) {
      if (seen.has(session.id)) continue;
      seen.add(session.id);
      ids.push(session.id);
    }
  }
  return ids;
}

/** Distinct sessions across every group, first occurrence wins. */
export function uniqueSessions(conflicts: SessionConflict[]): ConflictSession[] {
  const seen = new Map<number, ConflictSession>();
  for (const group of conflicts) {
    for (const session of group.sessions) {
      if (!seen.has(session.id)) seen.set(session.id, session);
    }
  }
  return [...seen.values()];
}

/** 'resolved' once every session in the review has a closing outcome. */
export function reviewStatusFor(
  conflicts: SessionConflict[],
  resolution: Resolution
): Extract<ReviewStatus, 'pending' | 'resolved'> {
  const ids = uniqueSessionIds(conflicts);
  return ids.every((id) => isHandled(resolution[String(id)])) ? 'resolved' : 'pending';
}

export interface MergedDetection {
  conflicts: SessionConflict[];
  resolution: Resolution;
}

/**
 * Fold a fresh detection into an open review. The fresh groups win, but a
 * session the admin already saw does not silently vanish: one that is no
 * longer in the fresh result stays in its old group and, if nobody had acted
 * on it, is marked `cleared` — it was cancelled in Momence by hand, or the
 * special event moved. A special event with nothing left to show is dropped.
 */
export function mergeDetection(
  prev: SessionConflict[],
  resolution: Resolution,
  next: SessionConflict[],
  now: Date,
  by: string
): MergedDetection {
  const merged: Resolution = { ...resolution };
  const nextIds = new Set(uniqueSessionIds(next));
  const nextByEvent = new Map(next.map((g) => [g.specialEvent.id, g]));
  const clearedEntry: ResolutionEntry = {
    outcome: 'cleared',
    message: 'No longer on the Momence schedule, or no longer overlapping',
    at: now.toISOString(),
    by,
  };

  const conflicts: SessionConflict[] = next.map((g) => ({
    specialEvent: g.specialEvent,
    sessions: [...g.sessions],
  }));

  for (const oldGroup of prev) {
    const gone = oldGroup.sessions.filter((s) => !nextIds.has(s.id));
    for (const session of gone) {
      const key = String(session.id);
      if (!isHandled(merged[key])) merged[key] = clearedEntry;
    }
    if (gone.length === 0) continue;

    const target = nextByEvent.get(oldGroup.specialEvent.id);
    if (target) {
      const live = conflicts.find((g) => g.specialEvent.id === target.specialEvent.id);
      if (live) live.sessions.push(...gone);
    } else {
      conflicts.push({ specialEvent: oldGroup.specialEvent, sessions: gone });
    }
  }

  conflicts.sort(
    (a, b) =>
      Date.parse(a.specialEvent.startsAt) - Date.parse(b.specialEvent.startsAt) ||
      a.specialEvent.id - b.specialEvent.id
  );
  return { conflicts, resolution: merged };
}
