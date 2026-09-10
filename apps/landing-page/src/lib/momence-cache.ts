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
//      already paid for the fetch, so this one just borrows the result.
//
// Momence is the slow, unreliable part — it answers in anything from 300ms to
// a gateway timeout, and the logs show it doing the latter a few times a
// week. So the rule is that a visitor never waits on it while there is
// anything recent to show instead: a snapshot older than SNAPSHOT_FRESH_MS
// but younger than SNAPSHOT_SERVE_STALE_MS is served immediately and refreshed
// *behind* the response (stale-while-revalidate, at the data layer). Only a
// missing or genuinely old snapshot blocks on Momence, and even that is
// capped by FETCH_TIMEOUT_MS.
//
// Redis is bounded too. Upstash's client defaults to five retries with
// exponential backoff and no request timeout, which on a bad day is a page
// that never loads; the cache uses its own client with a hard deadline and a
// single retry, and treats a failure as a miss.
//
// Staleness compounds across the layers and the edge cache in front of them:
// worst case a spot count is an hour or so behind, and Momence itself remains
// authoritative at checkout.
//
// A snapshot older than SNAPSHOT_SERVE_STALE_MS is still kept as the outage
// fallback, which is what the 7-day TTL is for — a stale calendar renders
// correctly because the transform pipeline drops past sessions by date anyway.

import { createRedis } from '@pyre/webhook-core';
import { waitUntil } from '@vercel/functions';
import { fetchMomenceTeachers } from '@/lib/momence';
import type { MomenceEvent, MomenceTeacher } from '@/lib/momence-types';

const MOMENCE_API_BASE = 'https://api.momence.com/api/v1';

/** A slow Momence must never hold a page open to the platform's limit. */
const FETCH_TIMEOUT_MS = 6_000;

/**
 * Hard deadline on a Redis round trip, retries included. Reading the snapshot
 * normally takes tens of milliseconds; anything approaching this is an
 * Upstash problem, and the page is better off going to Momence than waiting.
 */
const REDIS_TIMEOUT_MS = 2_000;

/** How long one instance trusts its own copy. */
const MEMO_TTL_MS = 30_000;

/** How fresh a shared snapshot has to be to serve without a refresh at all. */
const SNAPSHOT_FRESH_MS = 45_000;

/**
 * How old a shared snapshot can be and still be served immediately, with the
 * refresh happening behind the response rather than in front of it. Beyond
 * this the data is old enough — spot counts, a session pulled from the
 * calendar — that a visitor should wait for Momence.
 *
 * An hour, to match the edge cache in front of the event page: it already
 * serves HTML up to an hour old, so a stricter window here only put Momence
 * back in front of the first byte. At the traffic an event link sees, five
 * minutes meant nearly every first visit waited on it.
 */
const SNAPSHOT_SERVE_STALE_MS = 60 * 60_000;

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
/** The background refresh in progress on this instance, if any. */
let revalidating: Promise<void> | null = null;

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

// -- Redis -------------------------------------------------------------------

type CacheRedis = NonNullable<ReturnType<typeof createRedis>>;

// `undefined` until first use; `null` once we know Redis isn't configured, so
// the warning isn't repeated per request.
let redis: CacheRedis | null | undefined;

function cacheRedis(): CacheRedis | null {
  if (redis === undefined) {
    redis = createRedis({
      // A fresh signal per request, so one timed-out call doesn't poison the
      // client for every call after it. The client reuses the signal across
      // its retries, which makes this a deadline on the whole operation.
      signal: () => AbortSignal.timeout(REDIS_TIMEOUT_MS),
      retry: { retries: 1, backoff: () => 100 },
    });
  }
  return redis;
}

async function readSnapshot(): Promise<EventsSnapshot | null> {
  const client = cacheRedis();
  if (!client) return null;

  try {
    const snapshot = await client.get<EventsSnapshot>(SNAPSHOT_KEY);
    if (!snapshot || !Array.isArray(snapshot.events)) return null;
    return snapshot;
  } catch (error) {
    console.warn('[Momence cache] Failed to read snapshot:', error);
    return null;
  }
}

async function writeSnapshot(snapshot: EventsSnapshot): Promise<void> {
  const client = cacheRedis();
  if (!client) return;

  try {
    await client.set(SNAPSHOT_KEY, snapshot, { ex: SNAPSHOT_TTL_SECONDS });
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

// -- Momence -----------------------------------------------------------------

/**
 * Go to Momence, and record what came back for every other instance. Throws
 * when Momence is down or answers with nothing usable.
 */
async function fetchCalendar(previous: EventsSnapshot | null): Promise<MomenceCalendar> {
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

  // The roster endpoint flakes independently of the calendar. A blip there
  // shouldn't strip every practitioner bio from the site until the next
  // successful fetch, so a good roster outlives a failed refresh of it.
  const roster = teachers.length > 0 ? teachers : (previous?.teachers ?? []);

  const snapshot: EventsSnapshot = {
    events,
    teachers: roster,
    fetchedAt: new Date().toISOString(),
  };

  // Awaited so the shared snapshot is written even where nothing keeps the
  // function alive after the response; bounded by REDIS_TIMEOUT_MS either way.
  await writeSnapshot(snapshot);

  return toCalendar(snapshot, false);
}

/**
 * Refresh the snapshot without anyone waiting on it. On Vercel, `waitUntil`
 * keeps the function alive until the fetch lands; elsewhere (dev, tests) the
 * promise simply runs to completion in the background. One at a time per
 * instance — a burst of requests during the same stale window shares it.
 */
function revalidateInBackground(previous: EventsSnapshot): void {
  if (revalidating) return;

  revalidating = fetchCalendar(previous)
    .then((calendar) => {
      // Later requests on this instance get the fresh copy without a Redis
      // read; other instances pick it up from the snapshot just written.
      memo = { at: Date.now(), calendar };
    })
    .catch((error) => {
      // The stale snapshot keeps being served; the next request past the
      // memo will try again.
      console.error('[Momence cache] Background refresh failed:', error);
    })
    .finally(() => {
      revalidating = null;
    });

  waitUntil(revalidating);
}

async function refresh(): Promise<MomenceCalendar | null> {
  // Borrow another instance's recent work before spending a Momence round trip.
  // Held onto either way: it's also the fallback if the fetch below fails.
  const snapshot = await readSnapshot();
  const age = snapshot ? snapshotAgeMs(snapshot) : Number.POSITIVE_INFINITY;

  if (snapshot && age < SNAPSHOT_FRESH_MS) {
    return toCalendar(snapshot, false);
  }

  // Recent enough to show. Momence is consulted behind the response, never in
  // front of it — this is the branch that keeps a slow Momence off the page.
  if (snapshot && age < SNAPSHOT_SERVE_STALE_MS) {
    revalidateInBackground(snapshot);
    return toCalendar(snapshot, false);
  }

  try {
    return await fetchCalendar(snapshot);
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
