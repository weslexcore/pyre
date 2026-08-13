// Runtime API endpoint for fetching events from Momence
// This enables server-side fetching with edge caching for fresh data

import { getRedis } from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import {
  excludeVolunteerEvents,
  fetchMomenceTeachers,
  filterValidEvents,
  indexTeachersById,
  sortEventsByDate,
  transformToEventItem,
} from '@/lib/momence';
import type { MomenceEvent, MomenceTeacher } from '@/lib/momence-types';
import type { EventItem } from '@/lib/types';

export const prerender = false;

const MOMENCE_API_BASE = 'https://api.momence.com/api/v1';

interface EventsApiResponse {
  events: EventItem[];
  cached: boolean;
  timestamp: string;
  hasMore: boolean;
  totalUpcoming: number;
}

const MIN_LIMIT = 1;
const MAX_LIMIT = 50;

function parseLimit(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, parsed));
}

// Last-known-good snapshot of the raw Momence events, so intermittent Momence
// outages (e.g. 502s) don't blank the events page. The transform pipeline drops
// past events by date, so a slightly stale snapshot still renders correctly.
const EVENTS_SNAPSHOT_KEY = 'events:momence:last-good';
const EVENTS_SNAPSHOT_TTL_SECONDS = 7 * 24 * 60 * 60;

interface EventsSnapshot {
  events: MomenceEvent[];
  // Practitioner profiles for the snapshotted events. Absent on snapshots
  // written before practitioners were surfaced.
  teachers?: MomenceTeacher[];
  fetchedAt: string;
}

async function saveEventsSnapshot(
  events: MomenceEvent[],
  teachers: MomenceTeacher[]
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    const snapshot: EventsSnapshot = { events, teachers, fetchedAt: new Date().toISOString() };
    await redis.set(EVENTS_SNAPSHOT_KEY, snapshot, { ex: EVENTS_SNAPSHOT_TTL_SECONDS });
  } catch (error) {
    console.warn('[Events API] Failed to save events snapshot:', error);
  }
}

async function readEventsSnapshot(): Promise<EventsSnapshot | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const snapshot = await redis.get<EventsSnapshot>(EVENTS_SNAPSHOT_KEY);
    if (!snapshot || !Array.isArray(snapshot.events)) return null;
    return snapshot;
  } catch (error) {
    console.warn('[Events API] Failed to read events snapshot:', error);
    return null;
  }
}

async function fetchMomenceEventsServer(): Promise<MomenceEvent[]> {
  const hostId = import.meta.env.MOMENCE_HOST_ID;
  const apiToken = import.meta.env.MOMENCE_API_TOKEN;

  if (!hostId || !apiToken) {
    throw new Error('Missing credentials (MOMENCE_HOST_ID or MOMENCE_API_TOKEN)');
  }

  const url = `${MOMENCE_API_BASE}/Events?hostId=${hostId}&token=${apiToken}`;

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
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

export const GET: APIRoute = async ({ url }) => {
  try {
    const limit = parseLimit(url.searchParams.get('limit'));

    let rawEvents: MomenceEvent[];
    let teachers: MomenceTeacher[];
    let servedFromSnapshot = false;

    try {
      // The teacher roster carries the practitioner bios/headshots and is
      // best-effort — it resolves to an empty list instead of throwing.
      [rawEvents, teachers] = await Promise.all([
        fetchMomenceEventsServer(),
        fetchMomenceTeachers(),
      ]);
      // Awaited (serverless may kill work after the response), but never fatal.
      await saveEventsSnapshot(rawEvents, teachers);
    } catch (fetchError) {
      console.error('[Events API] Momence fetch failed:', fetchError);

      const snapshot = await readEventsSnapshot();
      if (!snapshot) {
        // No fallback available — return an explicit, uncacheable error so the
        // edge never caches an empty list as if it were a real result.
        return new Response(
          JSON.stringify({
            events: [],
            cached: false,
            timestamp: new Date().toISOString(),
            hasMore: false,
            totalUpcoming: 0,
            error: 'Events are temporarily unavailable',
          }),
          {
            status: 503,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
            },
          }
        );
      }

      console.warn(`[Events API] Serving last-known-good snapshot from ${snapshot.fetchedAt}`);
      rawEvents = snapshot.events;
      teachers = Array.isArray(snapshot.teachers) ? snapshot.teachers : [];
      servedFromSnapshot = true;
    }

    const validEvents = filterValidEvents(rawEvents);
    const nonVolunteerEvents = excludeVolunteerEvents(validEvents);
    const sortedEvents = sortEventsByDate(nonVolunteerEvents);
    const teachersById = indexTeachersById(teachers);
    const allEvents = sortedEvents.map((event) => transformToEventItem(event, teachersById));

    // No date-window filtering here — the calendar is curated on the Momence
    // side, so every upcoming event Momence returns is surfaced. `limit` only
    // truncates for compact surfaces like the homepage carousel.
    const events = limit !== null ? allEvents.slice(0, limit) : allEvents;
    const hasMore = limit !== null && allEvents.length > limit;

    const response: EventsApiResponse = {
      events,
      cached: servedFromSnapshot,
      timestamp: new Date().toISOString(),
      hasMore,
      totalUpcoming: allEvents.length,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // Vercel edge caching: 1 min fresh, serve stale up to 2 min while
        // revalidating. Snapshot fallbacks cache for less so recovery from a
        // Momence outage is picked up quickly.
        'Cache-Control': servedFromSnapshot
          ? 'public, s-maxage=30, stale-while-revalidate=60'
          : 'public, s-maxage=60, stale-while-revalidate=120',
      },
    });
  } catch (error) {
    console.error('[Events API] Error:', error);

    return new Response(
      JSON.stringify({
        events: [],
        cached: false,
        timestamp: new Date().toISOString(),
        hasMore: false,
        totalUpcoming: 0,
        error: 'Failed to fetch events',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }
    );
  }
};
