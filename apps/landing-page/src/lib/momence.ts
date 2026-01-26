// Momence Events API client
// Fetches events at build time and transforms them to EventItem format

import type { MomenceEvent } from './momence-types';
import type { EventItem, EventsContent } from './types';

const MOMENCE_API_BASE = 'https://api.momence.com/api/v1';

/**
 * Fetch events from the Momence API (via Ribbon)
 */
export async function fetchMomenceEvents(): Promise<MomenceEvent[]> {
  const hostId = import.meta.env.MOMENCE_HOST_ID;
  const apiToken = import.meta.env.MOMENCE_API_TOKEN;

  if (!hostId || !apiToken) {
    console.warn('[Momence] Missing API credentials (MOMENCE_HOST_ID or MOMENCE_API_TOKEN)');
    return [];
  }

  const url = `${MOMENCE_API_BASE}/Events?hostId=${hostId}&token=${apiToken}`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`[Momence] API returned ${response.status}: ${response.statusText}`);
      return [];
    }

    const data = await response.json();

    // The API returns an array of events directly
    if (Array.isArray(data)) {
      return data as MomenceEvent[];
    }

    // Or it might be wrapped in an object
    if (data.events && Array.isArray(data.events)) {
      return data.events as MomenceEvent[];
    }

    console.warn('[Momence] Unexpected API response format');
    return [];
  } catch (error) {
    console.error('[Momence] Failed to fetch events:', error);
    return [];
  }
}

/**
 * Filter out cancelled, deleted, unpublished, and past events
 */
export function filterValidEvents(events: MomenceEvent[]): MomenceEvent[] {
  const now = new Date();

  return events.filter((event) => {
    // Skip cancelled, deleted, or unpublished events
    if (event.isCancelled || event.isDeleted || !event.published) {
      return false;
    }

    // Skip past events
    const eventDate = new Date(event.dateTime);
    if (eventDate < now) {
      return false;
    }

    return true;
  });
}

/**
 * Sort events chronologically by date
 */
export function sortEventsByDate(events: MomenceEvent[]): MomenceEvent[] {
  return [...events].sort((a, b) => {
    return new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime();
  });
}

/**
 * Format a date string like "Wed, February 12, 2026"
 */
function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format a time range string like "6:00 PM - 8:00 PM"
 */
function formatTimeRange(isoDate: string, durationMinutes: number): string {
  const startDate = new Date(isoDate);
  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  return `${formatTime(startDate)} - ${formatTime(endDate)}`;
}

/**
 * Transform a Momence event to our EventItem format
 */
export function transformToEventItem(event: MomenceEvent): EventItem {
  // Use image1 if available, otherwise fall back to image2
  const imageUrl = event.image1 || event.image2;

  return {
    id: String(event.id),
    title: event.title,
    description: event.description || '',
    date: formatDate(event.dateTime),
    time: formatTimeRange(event.dateTime, event.duration),
    location: event.location || 'Pyre Sauna',
    image: imageUrl
      ? {
          src: imageUrl,
          alt: event.title,
        }
      : undefined,
    cta: {
      label: 'Reserve Spot',
      href: event.link,
      ariaLabel: `Reserve spot for ${event.title}`,
    },
    isoDate: event.dateTime, // Preserve original ISO date for filtering
    spotsRemaining: event.spotsRemaining,
  };
}

/**
 * Main function to fetch and transform Momence events
 * Returns fallback events if API is unavailable
 */
export async function getMomenceEvents(
  fallbackItems: EventItem[] = []
): Promise<EventItem[]> {
  try {
    const rawEvents = await fetchMomenceEvents();

    if (rawEvents.length === 0) {
      console.info('[Momence] No events from API, using fallback');
      return fallbackItems;
    }

    const validEvents = filterValidEvents(rawEvents);
    const sortedEvents = sortEventsByDate(validEvents);
    const transformedEvents = sortedEvents.map(transformToEventItem);

    if (transformedEvents.length === 0) {
      console.info('[Momence] No upcoming events, using fallback');
      return fallbackItems;
    }

    console.info(`[Momence] Loaded ${transformedEvents.length} upcoming events`);
    return transformedEvents;
  } catch (error) {
    console.error('[Momence] Error fetching events:', error);
    return fallbackItems;
  }
}

/**
 * Get full events content with Momence events or fallback
 */
export async function getEventsContentFromMomence(
  fallback: EventsContent
): Promise<EventsContent> {
  const items = await getMomenceEvents(fallback.items);

  return {
    ...fallback,
    items,
  };
}
