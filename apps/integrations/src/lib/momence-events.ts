// Momence v1 Events API client — used to resolve a booked session's type and
// display fields (title / date / time / location) for confirmation emails.
//
// Type resolution is TAG-FIRST (an explicit "Guided"/"Social" tag on the event),
// falling back to deriving the type from the session name — the same heuristic
// used by the data-dashboard (apps/data-dashboard/lib/data.ts), ported here.

import { createWebhookLogger } from '@pyre/webhook-core';

const log = createWebhookLogger('MomenceEvents');

const MOMENCE_API_V1 = 'https://api.momence.com/api/v1';
const TIME_ZONE = 'America/New_York';

interface MomenceEventLite {
  id: number;
  title: string;
  tags?: string[];
  dateTime: string; // ISO 8601
  duration: number; // minutes
  location?: string;
  image1?: string | null;
  image2?: string | null;
}

export interface ResolvedSession {
  /** Normalized lowercase type, e.g. "guided", "social", "open hours". */
  sessionType: string;
  title: string;
  dateLabel: string; // e.g. "Wed, February 12, 2026"
  timeLabel: string; // e.g. "6:00 PM - 8:00 PM"
  location: string;
  isoDate: string;
  /** The event's own image (same one shown on the landing page), if it has one. */
  imageUrl?: string;
}

/**
 * Derive a session type from its name. Ported from apps/data-dashboard/lib/data.ts.
 * Returns a lowercase key so it can route directly to email templates.
 */
export function deriveSessionType(sessionName: string): string {
  const name = sessionName.toLowerCase();
  if (name.includes('open hours') || name.includes('quiet flow')) return 'open hours';
  if (name.includes('guided')) return 'guided';
  if (name.includes('private')) return 'private';
  if (name.includes('sound')) return 'sound';
  if (name.includes('social') || name.includes('dj')) return 'social';
  if (
    name.includes('pilates') ||
    name.includes('yoga') ||
    name.includes('run') ||
    name.includes('hiit') ||
    name.includes('fitness') ||
    name.includes('tabata') ||
    name.includes('lolu fit') ||
    name.includes('boxing')
  ) {
    return 'fitness';
  }
  if (name.includes('maintenance')) return 'maintenance';
  return 'special event';
}

function resolveTypeFromEvent(event: MomenceEventLite): string {
  // Tag-first: an explicit Guided/Social tag wins over the name heuristic.
  for (const tag of event.tags ?? []) {
    const t = tag.toLowerCase();
    if (t === 'guided') return 'guided';
    if (t === 'social') return 'social';
  }
  return deriveSessionType(event.title);
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

function formatTimeRange(isoDate: string, durationMinutes: number): string {
  const start = new Date(isoDate);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const fmt = (d: Date) =>
    d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: TIME_ZONE,
    });
  return `${fmt(start)} - ${fmt(end)}`;
}

async function fetchEvents(): Promise<MomenceEventLite[]> {
  const hostId = import.meta.env.MOMENCE_HOST_ID;
  const apiToken = import.meta.env.MOMENCE_API_TOKEN;

  if (!hostId || !apiToken) {
    log.warn('Missing MOMENCE_HOST_ID or MOMENCE_API_TOKEN — cannot resolve session');
    return [];
  }

  const url = `${MOMENCE_API_V1}/Events?hostId=${hostId}&token=${apiToken}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });

  if (!response.ok) {
    log.warn(`Events API returned ${response.status}`);
    return [];
  }

  const data = await response.json();
  if (Array.isArray(data)) return data as MomenceEventLite[];
  if (Array.isArray(data?.events)) return data.events as MomenceEventLite[];
  log.warn('Unexpected Events API response shape');
  return [];
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
      imageUrl: event.image1 || event.image2 || undefined,
    };
  } catch (error) {
    log.warn(`Failed to resolve session ${sessionId}`, error);
    return null;
  }
}
