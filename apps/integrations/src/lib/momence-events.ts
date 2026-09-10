// Momence v1 Events API client — used to resolve a booked session's type and
// display fields (title / date / time / location) for confirmation emails.
//
// Type resolution is TAG-DRIVEN: the session type comes from an explicit Momence
// tag on the event (a controlled vocabulary), not the free-form title. Events
// without a recognized tag fall back to the generic "special event" type.

import { createWebhookLogger } from '@pyre/webhook-core';

const log = createWebhookLogger('MomenceEvents');

const MOMENCE_API_V1 = 'https://api.momence.com/api/v1';
/** The bathhouse's wall-clock zone; every customer-facing time is rendered in it. */
export const TIME_ZONE = 'America/New_York';

/**
 * One row of the v1 Events feed. The feed carries more than this (see the
 * landing page's MomenceEvent for the full shape); these are the fields
 * something here reads. Everything past `duration` is optional because the
 * feed has dropped and renamed fields across revisions — readers must cope
 * with their absence.
 */
export interface MomenceEvent {
  id: number;
  title: string;
  tags?: string[];
  dateTime: string; // ISO 8601
  duration: number; // minutes
  location?: string;
  image1?: string | null;
  image2?: string | null;
  isCancelled?: boolean;
  isDeleted?: boolean;
  /** Absent means published — the v1 feed is the public one. */
  published?: boolean;
  capacity?: number;
  spotsRemaining?: number;
  ticketsSold?: number;
  /** Momence's public booking page for the event. */
  link?: string;
}

export interface ResolvedSession {
  /** Normalized lowercase type, e.g. "guided", "social", "open hours". */
  sessionType: string;
  title: string;
  dateLabel: string; // e.g. "Wed, February 12, 2026"
  timeLabel: string; // e.g. "6:00 PM – 8:00 PM EST"
  location: string;
  isoDate: string;
  /** End of the session (`dateTime + duration`), ISO 8601 UTC. */
  endIso: string;
  /** The event's own image (same one shown on the landing page), if it has one. */
  imageUrl?: string;
  /**
   * No other session in the feed starts later the same (bathhouse) day. Last
   * entry is an hour before closing, so the confirmation's arrival window for
   * a drop-in session is tightened when this is set.
   */
  isLastOfDay: boolean;
}

// Type used when an event carries no recognized type tag. It is intentionally
// absent from CONFIRMATION_BY_TYPE / FAQS_BY_TYPE, so it routes to the general
// confirmation template + DEFAULT_FAQS.
const DEFAULT_SESSION_TYPE = 'general';

// Explicit Momence tags -> canonical session type. Tags are a controlled
// vocabulary set on the event, so we key off them rather than parsing the
// free-form title. Match is case-insensitive; add new tag spellings here.
// Canonical types must match the keys in FAQS_BY_TYPE (faq-content.ts) and
// CONFIRMATION_CONTENT (confirmation-content.ts).
const TAG_TO_TYPE: Record<string, string> = {
  guided: 'guided',
  social: 'social',
  'open hours': 'open hours',
  private: 'private',
  'private rental': 'private',
  sound: 'sound bath',
  'sound bath': 'sound bath',
  yoga: 'yoga',
  pilates: 'fitness',
  run: 'fitness',
  hiit: 'fitness',
  fitness: 'fitness',
  'special event': 'special event',
};

/** The canonical type for a special event's own tag. */
export const SPECIAL_EVENT_TYPE = 'special event';

/**
 * Every canonical session type, the special-event type included, in first-
 * appearance order. What the schedule lint's settings offer to choose from.
 */
export const SESSION_TYPES: readonly string[] = [...new Set(Object.values(TAG_TO_TYPE))];

/**
 * Canonical session type for a set of Momence tags — the first recognised
 * tag wins, unrecognised or missing tags fall back to the generic type.
 * Exported for the conflict check, which classifies every event in the feed
 * rather than one booked session.
 */
export function sessionTypeForTags(tags: string[] | undefined): string {
  for (const tag of tags ?? []) {
    const type = TAG_TO_TYPE[tag.toLowerCase().trim()];
    if (type) return type;
  }
  return DEFAULT_SESSION_TYPE;
}

function resolveTypeFromEvent(event: MomenceEvent): string {
  return sessionTypeForTags(event.tags);
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: TIME_ZONE,
  });
}

/** Clock time in the bathhouse zone, e.g. "6:00 PM". */
export function formatClockTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: TIME_ZONE,
  });
}

/** Short zone abbreviation in effect on `date`, e.g. "EDT" or "EST". */
export function formatZoneAbbrev(date: Date): string {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    timeZoneName: 'short',
  })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? 'ET';
}

/** Calendar day in the bathhouse zone, e.g. "6/20/2026"; only used for equality. */
function dayKey(date: Date): string {
  return date.toLocaleDateString('en-US', { timeZone: TIME_ZONE });
}

/**
 * True when nothing else in `allStarts` begins later on the same bathhouse
 * day as `startIso`. Exported for tests; resolveSession feeds it the whole
 * events feed.
 */
export function isLastSessionOfDay(startIso: string, allStarts: string[]): boolean {
  const start = new Date(startIso);
  const day = dayKey(start);
  return !allStarts.some((iso) => {
    const other = new Date(iso);
    return other.getTime() > start.getTime() && dayKey(other) === day;
  });
}

// The zone is spelled out once so guests booking from elsewhere (or reading on
// a phone set to another zone) aren't left guessing which clock we mean.
function formatTimeRange(isoDate: string, durationMinutes: number): string {
  const start = new Date(isoDate);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  return `${formatClockTime(start)} – ${formatClockTime(end)} ${formatZoneAbbrev(start)}`;
}

/**
 * The whole upcoming-events feed, drafts and all, exactly as Momence serves
 * it. Throws when the feed cannot be read — missing config, a non-2xx, or an
 * unrecognised shape — because the callers that want the whole feed (the
 * special-event conflict check) must not mistake an outage for an empty
 * calendar. resolveSession() below keeps its swallow-and-fall-back contract
 * through the private wrapper.
 */
export async function fetchMomenceEvents(): Promise<MomenceEvent[]> {
  const hostId = import.meta.env.MOMENCE_HOST_ID;
  const apiToken = import.meta.env.MOMENCE_API_TOKEN;

  if (!hostId || !apiToken) {
    throw new Error('Missing MOMENCE_HOST_ID or MOMENCE_API_TOKEN — cannot read the events feed');
  }

  const url = `${MOMENCE_API_V1}/Events?hostId=${hostId}&token=${apiToken}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });

  if (!response.ok) {
    throw new Error(`Momence Events API returned ${response.status}`);
  }

  const data = await response.json();
  if (Array.isArray(data)) return data as MomenceEvent[];
  if (Array.isArray(data?.events)) return data.events as MomenceEvent[];
  throw new Error('Unexpected Events API response shape');
}

async function fetchEvents(): Promise<MomenceEvent[]> {
  try {
    return await fetchMomenceEvents();
  } catch (error) {
    log.warn(error instanceof Error ? error.message : String(error));
    return [];
  }
}

/**
 * Resolve a booked session by its id. Returns null if the session cannot be
 * found (e.g. not in the upcoming-events feed) — callers should fall back to the
 * general confirmation with whatever payload data they have.
 */
export async function resolveSession(sessionId: number): Promise<ResolvedSession | null> {
  try {
    const events = await fetchEvents();
    const event = events.find((e) => Number(e.id) === Number(sessionId));
    if (!event) {
      log.warn(`Session ${sessionId} not found in events feed`);
      return null;
    }

    return {
      sessionType: resolveTypeFromEvent(event),
      title: event.title,
      dateLabel: formatDate(event.dateTime),
      timeLabel: formatTimeRange(event.dateTime, event.duration),
      location: event.location || 'Pyre Sauna',
      isoDate: event.dateTime,
      endIso: new Date(new Date(event.dateTime).getTime() + event.duration * 60_000).toISOString(),
      imageUrl: event.image1 || event.image2 || undefined,
      isLastOfDay: isLastSessionOfDay(
        event.dateTime,
        events.map((e) => e.dateTime)
      ),
    };
  } catch (error) {
    log.warn(`Failed to resolve session ${sessionId}`, error);
    return null;
  }
}
