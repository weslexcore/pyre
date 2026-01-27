// Runtime API endpoint for fetching events from Momence
// This enables server-side fetching with edge caching for fresh data

import type { APIRoute } from 'astro';
import { filterValidEvents, sortEventsByDate, transformToEventItem } from '@/lib/momence';
import type { MomenceEvent } from '@/lib/momence-types';
import type { EventItem } from '@/lib/types';

export const prerender = false;

const MOMENCE_API_BASE = 'https://api.momence.com/api/v1';

interface EventsApiResponse {
  events: EventItem[];
  cached: boolean;
  timestamp: string;
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

export const GET: APIRoute = async () => {
  try {
    const rawEvents = await fetchMomenceEventsServer();
    const validEvents = filterValidEvents(rawEvents);
    const sortedEvents = sortEventsByDate(validEvents);
    const events = sortedEvents.map(transformToEventItem);

    const response: EventsApiResponse = {
      events,
      cached: false,
      timestamp: new Date().toISOString(),
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // Vercel edge caching: 5 min fresh, serve stale up to 10 min while revalidating
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('[Events API] Error:', error);

    return new Response(
      JSON.stringify({
        events: [],
        cached: false,
        timestamp: new Date().toISOString(),
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
