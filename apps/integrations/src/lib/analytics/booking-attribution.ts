// Click→booking attribution inference.
//
// Bookings complete on Momence, so the web visitor who drove a booking is
// invisible to the server-side booking_completed event unless their email was
// identified on the site. But the booking CTA links to momence.com/s/<sessionId>
// and emits a client-side `booking_link_clicked` event — so when the Momence
// webhook delivers a booking for that same session id, recent clickers of that
// exact session are strong candidates for "the person who booked".
//
// This module queries PostHog for those clickers and decides:
//   - exactly one clicking person  → attribute person + campaign
//     (attribution_method: 'session_click_inference')
//   - several people, all carrying the same campaign → attribute campaign only
//     (attribution_method: 'session_click_shared_campaign')
//   - anything else → no attribution
//
// The result is stamped as event properties on booking_completed (no identity
// merge — inference can be wrong, and merges are irreversible). Campaign values
// are stamped RAW; the campaign-performance report slugify-normalizes on read,
// same as every other attribution source.
//
// Fail-safe by contract: `inferBookingAttribution` never throws and self-limits
// its latency, so it can never fail or stall the webhook. A missed match (e.g.
// PostHog ingestion lag hiding a fresh click) just means no attribution — the
// same as before this existed.

import { slugifyCampaign } from '@pyre/webhook-core';
import { isPostHogQueryConfigured, queryHogQL } from './posthog-query';

const DEFAULT_TIMEOUT_MS = 4000;
const LOOKBACK_MINUTES = 30;
// More distinct clickers than this within the window is ambiguity, not signal.
const MAX_CLICKERS = 10;

/** Keys are the final PostHog event property names so callers can spread directly. */
export interface BookingAttribution {
  attribution_method: 'session_click_inference' | 'session_click_shared_campaign';
  attributed_web_person_id?: string;
  attributed_utm_campaign?: string;
  attributed_utm_source?: string;
  attributed_utm_medium?: string;
}

export interface ClickerRow {
  personId: string;
  utmCampaign: string | null;
  utmSource: string | null;
  utmMedium: string | null;
}

/**
 * One row per distinct person who clicked this session's booking link in the
 * lookback window, with each person's most recent click's attribution. The
 * click's own utm_* (landing-URL attribution) wins over the person's
 * first-touch $initial_utm_* fallback. Session matching prefers the explicit
 * session_id property (newer clients) and falls back to parsing the /s/<id>
 * checkout href (older events).
 */
function buildClickersQuery(sessionId: number): string {
  const utm = (field: string) =>
    `argMax(coalesce(
       nullif(toString(properties.utm_${field}), ''),
       nullif(toString(person.properties.$initial_utm_${field}), '')
     ), timestamp) AS utm_${field}`;

  return `SELECT toString(person_id) AS person_id,
       ${utm('campaign')},
       ${utm('source')},
       ${utm('medium')}
FROM events
WHERE event = 'booking_link_clicked'
  AND timestamp >= now() - INTERVAL ${LOOKBACK_MINUTES} MINUTE
  AND coalesce(
        nullif(toString(properties.session_id), ''),
        extract(toString(properties.href), 's/([0-9]+)')
      ) = '${sessionId}'
GROUP BY person_id
LIMIT ${MAX_CLICKERS}`;
}

function parseRows(rows: unknown[][]): ClickerRow[] {
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
  return rows
    .map((row) => ({
      personId: str(row[0]) ?? '',
      utmCampaign: str(row[1]),
      utmSource: str(row[2]),
      utmMedium: str(row[3]),
    }))
    .filter((r) => r.personId !== '');
}

/** Pure decision logic, exported for unit tests. */
export function decideAttribution(rows: ClickerRow[]): BookingAttribution | null {
  if (rows.length === 0) return null;

  if (rows.length === 1) {
    const r = rows[0];
    return {
      attribution_method: 'session_click_inference',
      attributed_web_person_id: r.personId,
      ...(r.utmCampaign ? { attributed_utm_campaign: r.utmCampaign } : {}),
      ...(r.utmSource ? { attributed_utm_source: r.utmSource } : {}),
      ...(r.utmMedium ? { attributed_utm_medium: r.utmMedium } : {}),
    };
  }

  // Multiple clickers: we can't pick the person, but the campaign still holds
  // if EVERY clicker carries one and they all slugify to the same value (raw
  // variants like "Instagram Bio Links" vs "instagram-bio-links" roll up). A
  // campaign-less clicker could be the actual booker arriving direct, so any
  // missing campaign disqualifies the whole match.
  const slugs = new Set(rows.map((r) => (r.utmCampaign ? slugifyCampaign(r.utmCampaign) : '')));
  if (slugs.size === 1 && !slugs.has('')) {
    return {
      attribution_method: 'session_click_shared_campaign',
      attributed_utm_campaign: rows[0].utmCampaign as string,
    };
  }
  return null;
}

/**
 * Best-effort: never throws; resolves null on any failure, timeout, or when the
 * PostHog query API is unconfigured. Adds at most ~`timeoutMs` to the caller.
 */
export async function inferBookingAttribution(
  sessionId: number,
  options?: { timeoutMs?: number }
): Promise<BookingAttribution | null> {
  if (!isPostHogQueryConfigured()) return null;
  // Positive-integer check doubles as the SQL-interpolation guard.
  if (!Number.isInteger(sessionId) || sessionId <= 0) return null;

  try {
    const rows = await queryHogQL(buildClickersQuery(sessionId), {
      signal: AbortSignal.timeout(options?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    return decideAttribution(parseRows(rows));
  } catch (error) {
    console.warn(`[attribution] click inference failed for session ${sessionId}`, error);
    return null;
  }
}
