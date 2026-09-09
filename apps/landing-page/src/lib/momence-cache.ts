// Read-through cache for the Momence calendar.
//
// Every events surface — /events/<id>, /api/events, the sitemap — needs the
// same two things: the whole upcoming calendar and the teacher roster. Momence
// has no per-session endpoint, so "show me one event" costs the same fetch as
// "show me all of them": ~180 upcoming sessions with their full descriptions,
// plus the roster. Paying for that on every request put a third-party round
// trip in front of the first byte of every event page — twice over for the
// links that redirect to their canonical sibling.
//
// So the fetch is cached in two layers:
//
//   1. Per instance, in memory. A warm lambda serving a burst of event pages
//      (a link doing the rounds in a group chat) fetches nothing at all, and
//      concurrent requests share one in-flight promise instead of racing.
//   2. Across instances, in Redis. This reuses the snapshot /api/events already
//      wrote as an outage fallback — but reads it as a *cache* first: a
//      snapshot younger than SNAPSHOT_FRESH_MS means another instance has
//      already paid for the fetch, so this one just borrows the result. The
//      grid keeps it warm, which is why event pages rarely touch Momence.
//
// Staleness compounds across the layers and the edge cache in front of them, so
// the numbers are deliberately small: worst case a spot count is ~2 minutes
// behind, and Momence itself remains authoritative at checkout.
//
// A snapshot older than SNAPSHOT_FRESH_MS is still kept as the outage fallback,
// which is what the 7-day TTL is for — a stale calendar renders correctly
// because the transform pipeline drops past sessions by date anyway.

import { getRedis } from '@pyre/webhook-core';
import { fetchMomenceTeachers } from '@/lib/momence';
import type { MomenceEvent, MomenceTeacher } from '@/lib/momence-types';

const MOMENCE_API_BASE = 'https://api.momence.com/api/v1';

/** A slow Momence must never hold a page open to the platform's limit. */
const FETCH_TIMEOUT_MS = 6_000;

/** How long one instance trusts its own copy. */
const MEMO_TTL_MS = 30_000;

/** How fresh a shared snapshot has to be to serve without calling Momence. */
const SNAPSHOT_FRESH_MS = 45_000;

/**
 * How long a total failure is remembered. Short, so recovery is picked up
 * almost immediately, but long enough that a burst of requests doesn't each
 * spend FETCH_TIMEOUT_MS discovering the same dead Momence.
 */
const FAILURE_MEMO_TTL_MS = 5_000;

// Shared with the snapshot /api/events has always written — same key, same
// shape, so an existing snapshot stays readable and the outage behaviour that
// was built around it is unchanged.
const SNAPSHOT_KEY = 'events:momence:last-good';
const SNAPSHOT_TTL_SECONDS = 7 * 24 * 60 * 60;

interface EventsSnapshot {
  events: MomenceEvent[];
  // Practitioner profiles for the snapshotted events. Absent on snapshots
  // written before practitioners were surfaced.
  teachers?: MomenceTeacher[];
  fetchedAt: string;
}

export interface MomenceCalendar {
  events: MomenceEvent[];
  teachers: MomenceTeacher[];
  fetchedAt: string;
  /** True when Momence was unreachable and this is the last-known-good snapshot. */
  stale: boolean;
}

interface Memo {
  at: number;
  /** Null when the last attempt found neither Momence nor a snapshot. */
  calendar: MomenceCalendar | null;
}

let memo: Memo | null = null;
let inflight: Promise<MomenceCalendar | null> | null = null;

/**
 * Fetch the upcoming calendar from Momence. Unlike `fetchMomenceEvents`, this
 * throws on failure so the caller can fall back to the snapshot rather than
 * mistaking an outage for an empty calendar.
 */
export async function fetchMomenceEventsOrThrow(): Promise<MomenceEvent[]> {
  const hostId = import.meta.env.MOMENCE_HOST_ID;
  const apiToken = import.meta.env.MOMENCE_API_TOKEN;

  if (!hostId || !apiToken) {
    throw new Error('Missing credentials (MOMENCE_HOST_ID or MOMENCE_API_TOKEN)');
  }

  const url = `${MOMENCE_API_BASE}/Events?hostId=${hostId}&token=${apiToken}`;

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Momence returned ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  // Handle array or wrapped response
  if (Array.isArray(data)) {
    return data as MomenceEvent[];
  }
  if (data.events && Array.isArray(data.events)) {
    return data.events as MomenceEvent[];
  }

  throw new Error('Unexpected response format from Momence');
}

async function readSnapshot(): Promise<EventsSnapshot | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const snapshot = await redis.get<EventsSnapshot>(SNAPSHOT_KEY);
    if (!snapshot || !Array.isArray(snapshot.events)) return null;
    return snapshot;
  } catch (error) {
    console.warn('[Momence cache] Failed to read snapshot:', error);
    return null;
  }
}

async function writeSnapshot(events: MomenceEvent[], teachers: MomenceTeacher[]): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    const snapshot: EventsSnapshot = { events, teachers, fetchedAt: new Date().toISOString() };
    await redis.set(SNAPSHOT_KEY, snapshot, { ex: SNAPSHOT_TTL_SECONDS });
  } catch (error) {
    console.warn('[Momence cache] Failed to save snapshot:', error);
  }
}

function snapshotAgeMs(snapshot: EventsSnapshot): number {
  const at = Date.parse(snapshot.fetchedAt);
  return Number.isFinite(at) ? Date.now() - at : Number.POSITIVE_INFINITY;
}

function toCalendar(snapshot: EventsSnapshot, stale: boolean): MomenceCalendar {
  return {
    events: snapshot.events,
    teachers: Array.isArray(snapshot.teachers) ? snapshot.teachers : [],
    fetchedAt: snapshot.fetchedAt,
    stale,
  };
}

async function refresh(): Promise<MomenceCalendar | null> {
  // Borrow another instance's recent work before spending a Momence round trip.
  // Held onto either way: it's also the fallback if the fetch below fails.
  const snapshot = await readSnapshot();
  if (snapshot && snapshotAgeMs(snapshot) < SNAPSHOT_FRESH_MS) {
    return toCalendar(snapshot, false);
  }

  try {
    // The teacher roster carries practitioner bios/headshots and is
    // best-effort — it resolves to an empty list instead of throwing.
    const [events, teachers] = await Promise.all([
      fetchMomenceEventsOrThrow(),
      fetchMomenceTeachers(),
    ]);

    // Pyre always has sessions on the calendar, so an empty list is a failed
    // fetch wearing a success's clothes. Treat it as the outage it is rather
    // than caching it over a good snapshot.
    if (events.length === 0) {
      throw new Error('Momence returned an empty calendar');
    }

    // Awaited (serverless may kill work after the response), but never fatal.
    await writeSnapshot(events, teachers);

    return { events, teachers, fetchedAt: new Date().toISOString(), stale: false };
  } catch (error) {
    console.error('[Momence cache] Fetch failed:', error);

    if (snapshot) {
      console.warn(`[Momence cache] Serving last-known-good snapshot from ${snapshot.fetchedAt}`);
      return toCalendar(snapshot, true);
    }

    return null;
  }
}

/**
 * The upcoming calendar and teacher roster, from the cheapest layer that has
 * them. Resolves to null only when Momence is unreachable *and* no snapshot
 * exists — callers should say so rather than render an empty calendar as fact.
 */
export async function loadMomenceCalendar(): Promise<MomenceCalendar | null> {
  const ttl = memo?.calendar ? MEMO_TTL_MS : FAILURE_MEMO_TTL_MS;
  if (memo && Date.now() - memo.at < ttl) {
    return memo.calendar;
  }

  // One refresh per instance at a time: a burst of concurrent requests on a
  // cold lambda shares a single fetch instead of stampeding Momence.
  if (!inflight) {
    inflight = refresh().finally(() => {
      inflight = null;
    });
  }

  const calendar = await inflight;

  // Outages are memoised too — a stale snapshot, or the absence of one, so that
  // every request during an outage isn't re-hammering a Momence that is already
  // failing. Both age out fast, so recovery is picked up quickly.
  memo = { at: Date.now(), calendar };

  return calendar;
}
