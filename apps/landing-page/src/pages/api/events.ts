// Runtime API endpoint for fetching events from Momence
// This enables server-side fetching with edge caching for fresh data

import type { APIRoute } from 'astro';
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

async function fetchMomenceEventsServer(): Promise<MomenceEvent[]> {
  const hostId = import.meta.env.MOMENCE_HOST_ID;
  const apiToken = import.meta.env.MOMENCE_API_TOKEN;

  if (!hostId || !apiToken) {
    console.warn('[Events API] Missing credentials (MOMENCE_HOST_ID or MOMENCE_API_TOKEN)');
    return [];
  }

  const url = `${MOMENCE_API_BASE}/Events?hostId=${hostId}&token=${apiToken}`;

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    console.error(`[Events API] Momence returned ${response.status}: ${response.statusText}`);
    return [];
  }

  const data = await response.json();

  // Handle array or wrapped response
  if (Array.isArray(data)) {
    return data as MomenceEvent[];
  }
  if (data.events && Array.isArray(data.events)) {
    return data.events as MomenceEvent[];
  }

  console.warn('[Events API] Unexpected response format');
  return [];
}

export const GET: APIRoute = async ({ url }) => {
  try {
    const wantsAll = url.searchParams.get('all') === '1';
    const windowDays = parseWindowDays(url.searchParams.get('days'));
    const limit = parseLimit(url.searchParams.get('limit'));

    const rawEvents = await fetchMomenceEventsServer();
    const validEvents = filterValidEvents(rawEvents);
    const nonVolunteerEvents = excludeVolunteerEvents(validEvents);
    const sortedEvents = sortEventsByDate(nonVolunteerEvents);
    const allEvents = sortedEvents.map(transformToEventItem);

    let events: EventItem[];
    let hasMore: boolean;

    if (limit !== null && !wantsAll) {
      events = allEvents.slice(0, limit);
      hasMore = allEvents.length > limit;
    } else if (wantsAll) {
      events = allEvents;
      hasMore = false;
    } else {
      const cutoff = Date.now() + windowDays * 24 * 60 * 60 * 1000;
      const eventsInWindow: EventItem[] = [];
      let restCount = 0;
      for (const event of allEvents) {
        if (!event.isoDate) {
          eventsInWindow.push(event);
          continue;
        }
        const eventTime = new Date(event.isoDate).getTime();
        if (Number.isFinite(eventTime) && eventTime > cutoff) {
          restCount += 1;
        } else {
          eventsInWindow.push(event);
        }
      }
      events = eventsInWindow;
      hasMore = restCount > 0;
    }

    const response: EventsApiResponse = {
      events,
      cached: false,
      timestamp: new Date().toISOString(),
      hasMore,
      totalUpcoming: allEvents.length,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // Vercel edge caching: 1 min fresh, serve stale up to 2 min while revalidating
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
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
