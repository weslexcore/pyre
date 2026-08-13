// Momence Events API client
// Fetches events at build time and transforms them to EventItem format

import type { MomenceEvent, MomenceTeacher } from './momence-types';
import { toPractitioner } from './practitioners';
import type { EventItem, EventsContent, Practitioner } from './types';

const MOMENCE_API_BASE = 'https://api.momence.com/api/v1';

/**
 * Tag used in Momence to mark volunteer / work-trade events.
 * Tagged events are surfaced on /volunteer and excluded from the main schedule.
 */
export const VOLUNTEER_TAG = 'Volunteer';

function hasTag(event: MomenceEvent, tag: string): boolean {
  return Array.isArray(event.tags) && event.tags.some((t) => t.toLowerCase() === tag.toLowerCase());
}

export function excludeVolunteerEvents(events: MomenceEvent[]): MomenceEvent[] {
  return events.filter((event) => !hasTag(event, VOLUNTEER_TAG));
}

export function onlyVolunteerEvents(events: MomenceEvent[]): MomenceEvent[] {
  return events.filter((event) => hasTag(event, VOLUNTEER_TAG));
}

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
 * Fetch the teacher roster from Momence. This is the source of practitioner
 * bios and headshots — never fatal, an empty list just means practitioners
 * render with their name alone.
 */
export async function fetchMomenceTeachers(): Promise<MomenceTeacher[]> {
  const hostId = import.meta.env.MOMENCE_HOST_ID;
  const apiToken = import.meta.env.MOMENCE_API_TOKEN;

  if (!hostId || !apiToken) return [];

  const url = `${MOMENCE_API_BASE}/Teachers?hostId=${hostId}&token=${apiToken}`;

  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });

    if (!response.ok) {
      console.error(`[Momence] Teachers API returned ${response.status}: ${response.statusText}`);
      return [];
    }

    const data = await response.json();
    return Array.isArray(data) ? (data as MomenceTeacher[]) : [];
  } catch (error) {
    console.error('[Momence] Failed to fetch teachers:', error);
    return [];
  }
}

/** Index the teacher roster by Momence teacher id for event lookups. */
export function indexTeachersById(teachers: MomenceTeacher[]): Map<number, MomenceTeacher> {
  return new Map(teachers.map((teacher) => [teacher.id, teacher]));
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
    timeZone: 'America/New_York',
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
      timeZone: 'America/New_York',
    });
  };

  return `${formatTime(startDate)} - ${formatTime(endDate)}`;
}

/**
 * Append `skipPreview=true` to a Momence checkout link so customers land
 * directly in the booking flow instead of the session preview page.
 */
function withSkipPreview(link: string): string {
  try {
    const url = new URL(link);
    url.searchParams.set('skipPreview', 'true');
    return url.toString();
  } catch {
    return link;
  }
}

/**
 * The people leading a session — the primary teacher first, then any additional
 * teachers. The primary teacher is looked up in the Momence teacher roster (by
 * id) so their bio and headshot come along; additional teachers only give us a
 * name. House accounts (e.g. "Pyre Sauna") and duplicates are dropped, and the
 * local roster in `lib/practitioners` can override any of it.
 */
function collectPractitioners(
  event: MomenceEvent,
  teachersById?: Map<number, MomenceTeacher>
): Practitioner[] {
  const roster = teachersById?.get(event.teacherId);

  const candidates: Array<Practitioner | undefined> = [
    toPractitioner(event.teacher, roster),
    ...(Array.isArray(event.additionalTeachers) ? event.additionalTeachers : []).map((teacher) =>
      toPractitioner(`${teacher?.firstName ?? ''} ${teacher?.lastName ?? ''}`)
    ),
  ];

  const seen = new Set<string>();
  const practitioners: Practitioner[] = [];

  for (const practitioner of candidates) {
    if (!practitioner || seen.has(practitioner.name.toLowerCase())) continue;
    seen.add(practitioner.name.toLowerCase());
    practitioners.push(practitioner);
  }

  return practitioners;
}

/**
 * Transform a Momence event to our EventItem format
 */
export function transformToEventItem(
  event: MomenceEvent,
  teachersById?: Map<number, MomenceTeacher>
): EventItem {
  // Use image1 if available, otherwise fall back to image2
  const imageUrl = event.image1 || event.image2;

  const isPrivate = event.type === 'private';

  // Show "Join Waitlist" when event is full
  const isFull = event.spotsRemaining === 0;
  const ctaLabel = isFull ? 'Join Waitlist' : 'Book Now';
  const ctaAriaLabel = isFull ? `Join waitlist for ${event.title}` : `Book ${event.title}`;

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
    cta: isPrivate
      ? undefined
      : {
          label: ctaLabel,
          href: withSkipPreview(event.link),
          ariaLabel: ctaAriaLabel,
        },
    isoDate: event.dateTime, // Preserve original ISO date for filtering
    durationMinutes: event.duration, // Minutes; drives the open-hours occupancy math
    priceUsd: event.fixedPrice, // USD drop-in price; credit cost is derived from this
    spotsRemaining: isPrivate ? undefined : event.spotsRemaining,
    totalSpots: isPrivate ? undefined : event.capacity,
    isPrivate,
    tags: Array.isArray(event.tags) ? event.tags : [],
    practitioners: collectPractitioners(event, teachersById),
  };
}

/**
 * Main function to fetch and transform Momence events
 * Returns fallback events if API is unavailable
 */
export async function getMomenceEvents(fallbackItems: EventItem[] = []): Promise<EventItem[]> {
  try {
    // The teacher roster (practitioner bios/headshots) is best-effort — it
    // resolves to an empty list rather than failing the events fetch.
    const [rawEvents, teachers] = await Promise.all([fetchMomenceEvents(), fetchMomenceTeachers()]);

    if (rawEvents.length === 0) {
      console.info('[Momence] No events from API, using fallback');
      return fallbackItems;
    }

    const teachersById = indexTeachersById(teachers);
    const validEvents = filterValidEvents(rawEvents);
    const nonVolunteerEvents = excludeVolunteerEvents(validEvents);
    const sortedEvents = sortEventsByDate(nonVolunteerEvents);
    const transformedEvents = sortedEvents.map((event) =>
      transformToEventItem(event, teachersById)
    );

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
export async function getEventsContentFromMomence(fallback: EventsContent): Promise<EventsContent> {
  const items = await getMomenceEvents(fallback.items);

  return {
    ...fallback,
    items,
  };
}
