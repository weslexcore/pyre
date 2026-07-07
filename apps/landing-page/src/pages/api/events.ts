// Runtime API endpoint for fetching events from Momence
// This enables server-side fetching with edge caching for fresh data

import { getRedis } from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import { isSpecialEvent } from '@/lib/events-config';
import {
  excludeVolunteerEvents,
  filterValidEvents,
  sortEventsByDate,
  transformToEventItem,
} from '@/lib/momence';
import type { MomenceEvent } from '@/lib/momence-types';
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

const DEFAULT_WINDOW_DAYS = 60;
const MIN_WINDOW_DAYS = 1;
const MAX_WINDOW_DAYS = 730;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;

function parseWindowDays(raw: string | null): number {
  if (!raw) return DEFAULT_WINDOW_DAYS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_WINDOW_DAYS;
  return Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, parsed));
}

function parseLimit(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, parsed));
}

function filterEventsByWindow(
  events: EventItem[],
  windowDays: number
): { eventsInWindow: EventItem[]; outsideWindowCount: number } {
  const cutoff = Date.now() + windowDays * 24 * 60 * 60 * 1000;
  const eventsInWindow: EventItem[] = [];
  let outsideWindowCount = 0;

  for (const event of events) {
    // Special events bypass the window entirely — always surface them, and don't
    // count them as "outside the window" (so they never falsely trigger hasMore).
    if (!event.isoDate || isSpecialEvent(event)) {
      eventsInWindow.push(event);
      continue;
    }

    const eventTime = new Date(event.isoDate).getTime();
    if (Number.isFinite(eventTime) && eventTime > cutoff) {
      outsideWindowCount += 1;
    } else {
      eventsInWindow.push(event);
    }
  }

  return { eventsInWindow, outsideWindowCount };
}

// Last-known-good snapshot of the raw Momence events, so intermittent Momence
// outages (e.g. 502s) don't blank the events page. The transform pipeline drops
// past events by date, so a slightly stale snapshot still renders correctly.
const EVENTS_SNAPSHOT_KEY = 'events:momence:last-good';
const EVENTS_SNAPSHOT_TTL_SECONDS = 7 * 24 * 60 * 60;

interface EventsSnapshot {
  events: MomenceEvent[];
  fetchedAt: string;
}

async function saveEventsSnapshot(events: MomenceEvent[]): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    const snapshot: EventsSnapshot = { events, fetchedAt: new Date().toISOString() };
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
    const wantsAll = url.searchParams.get('all') === '1';
    const daysParam = url.searchParams.get('days');
    const windowDays = parseWindowDays(daysParam);
    const limit = parseLimit(url.searchParams.get('limit'));

    let rawEvents: MomenceEvent[];
    let servedFromSnapshot = false;

    try {
      rawEvents = await fetchMomenceEventsServer();
      // Awaited (serverless may kill work after the response), but never fatal.
      await saveEventsSnapshot(rawEvents);
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
      servedFromSnapshot = true;
    }

    const validEvents = filterValidEvents(rawEvents);
    const nonVolunteerEvents = excludeVolunteerEvents(validEvents);
    const sortedEvents = sortEventsByDate(nonVolunteerEvents);
    const allEvents = sortedEvents.map(transformToEventItem);

    let events: EventItem[];
    let hasMore: boolean;

    if (wantsAll) {
      events = allEvents;
      hasMore = false;
    } else if (limit !== null) {
      const candidateEvents =
        daysParam === null ? allEvents : filterEventsByWindow(allEvents, windowDays).eventsInWindow;
      events = candidateEvents.slice(0, limit);
      hasMore = candidateEvents.length > limit;
    } else {
      const { eventsInWindow, outsideWindowCount } = filterEventsByWindow(allEvents, windowDays);
      events = eventsInWindow;
      hasMore = outsideWindowCount > 0;
    }

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
