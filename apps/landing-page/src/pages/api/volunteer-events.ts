// Runtime API endpoint for fetching volunteer-tagged events from Momence.
// Mirrors /api/events but returns ONLY events tagged with VOLUNTEER_TAG.

import type { APIRoute } from 'astro';
import {
  filterValidEvents,
  onlyVolunteerEvents,
  sortEventsByDate,
  transformToEventItem,
} from '@/lib/momence';
import type { MomenceEvent } from '@/lib/momence-types';
import type { EventItem } from '@/lib/types';

export const prerender = false;

const MOMENCE_API_BASE = 'https://api.momence.com/api/v1';

interface VolunteerEventsApiResponse {
  events: EventItem[];
  cached: boolean;
  timestamp: string;
}

async function fetchMomenceEventsServer(): Promise<MomenceEvent[]> {
  const hostId = import.meta.env.MOMENCE_HOST_ID;
  const apiToken = import.meta.env.MOMENCE_API_TOKEN;

  if (!hostId || !apiToken) {
    console.warn(
      '[Volunteer Events API] Missing credentials (MOMENCE_HOST_ID or MOMENCE_API_TOKEN)'
    );
    return [];
  }

  const url = `${MOMENCE_API_BASE}/Events?hostId=${hostId}&token=${apiToken}`;

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    console.error(
      `[Volunteer Events API] Momence returned ${response.status}: ${response.statusText}`
    );
    return [];
  }

  const data = await response.json();

  if (Array.isArray(data)) {
    return data as MomenceEvent[];
  }
  if (data.events && Array.isArray(data.events)) {
    return data.events as MomenceEvent[];
  }

  console.warn('[Volunteer Events API] Unexpected response format');
  return [];
}

export const GET: APIRoute = async () => {
  try {
    const rawEvents = await fetchMomenceEventsServer();
    const validEvents = filterValidEvents(rawEvents);
    const volunteerEvents = onlyVolunteerEvents(validEvents);
    const sortedEvents = sortEventsByDate(volunteerEvents);
    const events = sortedEvents.map(transformToEventItem);

    const response: VolunteerEventsApiResponse = {
      events,
      cached: false,
      timestamp: new Date().toISOString(),
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    });
  } catch (error) {
    console.error('[Volunteer Events API] Error:', error);

    return new Response(
      JSON.stringify({
        events: [],
        cached: false,
        timestamp: new Date().toISOString(),
        error: 'Failed to fetch volunteer events',
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
