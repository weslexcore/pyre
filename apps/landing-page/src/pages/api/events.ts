// Runtime API endpoint for fetching events from Momence
// This enables server-side fetching with edge caching for fresh data
//
// The fetch itself — and the last-known-good snapshot that backs it during a
// Momence outage — lives in lib/momence-cache, shared with the server-rendered
// event pages. This endpoint is the busiest events surface, so it is mostly
// what keeps that shared snapshot warm.

import type { APIRoute } from 'astro';
import {
  excludeVolunteerEvents,
  filterPublishedEvents,
  filterValidEvents,
  indexTeachersById,
  sortEventsByDate,
  sortEventsUpcomingFirst,
  transformToEventItem,
} from '@/lib/momence';
import { loadMomenceCalendar } from '@/lib/momence-cache';
import type { EventItem } from '@/lib/types';

export const prerender = false;

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

export const GET: APIRoute = async ({ url }) => {
  try {
    const limit = parseLimit(url.searchParams.get('limit'));
    // `all=1` keeps events that have already happened. The campaigns admin
    // picker asks for it: a campaign built for an event has to keep naming
    // that event after the date passes, instead of reading as if nothing was
    // ever picked. Public callers omit it and see upcoming events only.
    const includePast = url.searchParams.get('all') === '1';

    const calendar = await loadMomenceCalendar();

    if (!calendar) {
      // Momence is down and there is no snapshot to fall back to — return an
      // explicit, uncacheable error so the edge never caches an empty list as
      // if it were a real result.
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

    const { events: rawEvents, teachers, stale: servedFromSnapshot } = calendar;

    const validEvents = includePast
      ? filterPublishedEvents(rawEvents)
      : filterValidEvents(rawEvents);
    const nonVolunteerEvents = excludeVolunteerEvents(validEvents);
    const sortedEvents = includePast
      ? sortEventsUpcomingFirst(nonVolunteerEvents)
      : sortEventsByDate(nonVolunteerEvents);
    const teachersById = indexTeachersById(teachers);
    const allEvents = sortedEvents.map((event) => transformToEventItem(event, teachersById));

    // No date-window filtering here — the calendar is curated on the Momence
    // side, so every upcoming event Momence returns is surfaced. `limit` only
    // truncates for compact surfaces like the homepage carousel.
    const events = limit !== null ? allEvents.slice(0, limit) : allEvents;
    const hasMore = limit !== null && allEvents.length > limit;
    // Still a count of what is coming up, even when past events ride along.
    const totalUpcoming = includePast
      ? excludeVolunteerEvents(filterValidEvents(rawEvents)).length
      : allEvents.length;

    const response: EventsApiResponse = {
      events,
      cached: servedFromSnapshot,
      timestamp: new Date().toISOString(),
      hasMore,
      totalUpcoming,
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
