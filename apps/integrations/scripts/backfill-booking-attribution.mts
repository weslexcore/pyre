// One-off backfill: replay click→booking attribution inference over historical
// booking_completed events that predate the live webhook inference (see
// src/lib/analytics/booking-attribution.ts).
//
// PostHog events are immutable, so instead of editing past bookings this emits a
// companion `booking_attribution_backfill` event per match — same distinct id
// (the member email) and the ORIGINAL booking timestamp, carrying the same
// attribution properties the live path would have stamped, plus
// `backfilled: true` and the session/booking ids for joining. The
// campaign-performance report counts these into the bookings bucket.
//
// Scope: bookings from the last 90 days that have no first-touch campaign (at
// event time) and no live-stamped attribution. Idempotent: bookings that already
// have a backfill event (by session_booking_id) are skipped, so re-running is
// safe.
//
// Run (from apps/integrations, needs POSTHOG_PERSONAL_API_KEY + POSTHOG_PROJECT_ID
// in .env; POSTHOG_API_KEY too when executing):
//   tsx scripts/backfill-booking-attribution.mts            # dry run (default)
//   tsx scripts/backfill-booking-attribution.mts --execute  # actually emit events

import { PostHog } from 'posthog-node';
import {
  type ClickerRow,
  decideAttribution,
} from '../src/lib/analytics/booking-attribution';

const BACKFILL_EVENT = 'booking_attribution_backfill';
const BOOKING_DAYS = 90;
const LOOKBACK_MINUTES = 30; // must match booking-attribution.ts

// Load apps/integrations/.env if present (vars may also come from the shell).
try {
  process.loadEnvFile(new URL('../.env', import.meta.url).pathname);
} catch {
  // no .env file — rely on exported environment variables
}

const HOST = process.env.POSTHOG_HOST || 'https://us.posthog.com';
const PERSONAL_API_KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID;
const CAPTURE_API_KEY = process.env.POSTHOG_API_KEY;
const execute = process.argv.includes('--execute');

if (!PERSONAL_API_KEY || !PROJECT_ID) {
  console.error('Missing POSTHOG_PERSONAL_API_KEY or POSTHOG_PROJECT_ID');
  process.exit(1);
}
if (execute && !CAPTURE_API_KEY) {
  console.error('Missing POSTHOG_API_KEY (required with --execute)');
  process.exit(1);
}

// Local HogQL client on process.env — the app's queryHogQL reads import.meta.env,
// which does not exist under tsx.
async function queryHogQL(query: string): Promise<unknown[][]> {
  const res = await fetch(`${HOST}/api/projects/${PROJECT_ID}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PERSONAL_API_KEY}`,
    },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  });
  if (!res.ok) {
    throw new Error(`PostHog query failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as { results?: unknown[][] };
  return json.results ?? [];
}

// ---------------------------------------------------------------------------
// 1. Already-backfilled bookings (idempotency). Backfill events carry historical
//    timestamps, so the window must cover the whole booking range.
const backfilledRows = await queryHogQL(
  `SELECT DISTINCT toString(properties.session_booking_id)
   FROM events
   WHERE event = '${BACKFILL_EVENT}'
     AND timestamp >= now() - INTERVAL ${BOOKING_DAYS + 1} DAY
   LIMIT 5000`
);
const alreadyBackfilled = new Set(backfilledRows.map((r) => String(r[0])));

// ---------------------------------------------------------------------------
// 2. One batch query: every unattributed booking joined to the distinct persons
//    who clicked its session's booking link in the 30 minutes before it, with
//    each person's most recent click's attribution (event utm_* first, person
//    first-touch fallback — mirroring buildClickersQuery in the live module).
const utm = (field: string) =>
  `coalesce(
     nullif(toString(properties.utm_${field}), ''),
     nullif(toString(person.properties.$initial_utm_${field}), '')
   ) AS ${field}`;

const rows = await queryHogQL(
  `WITH bookings AS (
     SELECT uuid,
            toString(properties.session_id) AS sid,
            toString(properties.session_booking_id) AS sbid,
            distinct_id,
            timestamp AS book_ts
     FROM events
     WHERE event = 'booking_completed'
       AND timestamp >= now() - INTERVAL ${BOOKING_DAYS} DAY
       AND (person.properties.$initial_utm_campaign IS NULL
            OR person.properties.$initial_utm_campaign = '')
       AND properties.attribution_method IS NULL
   ),
   clicks AS (
     SELECT person_id,
            coalesce(
              nullif(toString(properties.session_id), ''),
              extract(toString(properties.href), 's/([0-9]+)')
            ) AS sid,
            timestamp AS click_ts,
            ${utm('campaign')},
            ${utm('source')},
            ${utm('medium')}
     FROM events
     WHERE event = 'booking_link_clicked'
       AND timestamp >= now() - INTERVAL ${BOOKING_DAYS + 1} DAY
   )
   SELECT toString(b.uuid) AS booking_uuid,
          b.sbid AS session_booking_id,
          b.sid AS session_id,
          b.distinct_id AS distinct_id,
          toString(b.book_ts) AS book_ts,
          toString(c.person_id) AS person_id,
          argMax(c.campaign, c.click_ts) AS utm_campaign,
          argMax(c.source, c.click_ts) AS utm_source,
          argMax(c.medium, c.click_ts) AS utm_medium
   FROM bookings b
   JOIN clicks c ON c.sid = b.sid
   WHERE c.click_ts <= b.book_ts
     AND c.click_ts >= b.book_ts - INTERVAL ${LOOKBACK_MINUTES} MINUTE
   GROUP BY booking_uuid, session_booking_id, session_id, distinct_id, book_ts, person_id
   LIMIT 5000`
);

// ---------------------------------------------------------------------------
// 3. Group clicker rows per booking and run the shared decision logic.
interface BookingCandidate {
  sessionBookingId: string;
  sessionId: string;
  distinctId: string;
  bookTs: string;
  clickers: ClickerRow[];
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const byBooking = new Map<string, BookingCandidate>();
for (const row of rows) {
  const [uuid, sbid, sid, distinctId, bookTs, personId, campaign, source, medium] = row;
  const key = String(uuid);
  const entry = byBooking.get(key) ?? {
    sessionBookingId: String(sbid),
    sessionId: String(sid),
    distinctId: String(distinctId),
    bookTs: String(bookTs),
    clickers: [],
  };
  if (str(personId)) {
    entry.clickers.push({
      personId: String(personId),
      utmCampaign: str(campaign),
      utmSource: str(source),
      utmMedium: str(medium),
    });
  }
  byBooking.set(key, entry);
}

let skipped = 0;
let unmatched = 0;
const toEmit: Array<BookingCandidate & { attribution: NonNullable<ReturnType<typeof decideAttribution>> }> = [];
for (const candidate of byBooking.values()) {
  if (alreadyBackfilled.has(candidate.sessionBookingId)) {
    skipped++;
    continue;
  }
  const attribution = decideAttribution(candidate.clickers);
  if (!attribution) {
    unmatched++;
    continue;
  }
  toEmit.push({ ...candidate, attribution });
}

// ---------------------------------------------------------------------------
// 4. Report, and emit when --execute.
const withCampaign = toEmit.filter((e) => e.attribution.attributed_utm_campaign);
console.log(`Bookings with clickers in window : ${byBooking.size}`);
console.log(`Already backfilled (skipped)     : ${skipped}`);
console.log(`No confident match               : ${unmatched}`);
console.log(`Matches to emit                  : ${toEmit.length} (${withCampaign.length} with campaign)`);
for (const e of withCampaign) {
  console.log(
    `  ${e.bookTs}  session ${e.sessionId}  ${e.attribution.attribution_method}  campaign=${e.attribution.attributed_utm_campaign}`
  );
}

if (!execute) {
  console.log('\nDry run — pass --execute to emit events.');
  process.exit(0);
}

// HogQL returns UTC timestamps without a zone marker ("2026-07-29 17:08:06.708000");
// normalize to ISO-with-Z so Date doesn't parse them as local time, and trim the
// microseconds V8's ISO parser may reject.
function toUtcDate(hogqlTs: string): Date {
  return new Date(`${hogqlTs.replace(' ', 'T').replace(/(\.\d{3})\d*/, '$1')}Z`);
}

const posthog = new PostHog(CAPTURE_API_KEY as string, { host: HOST, flushAt: 20 });
for (const e of toEmit) {
  posthog.capture({
    distinctId: e.distinctId,
    event: BACKFILL_EVENT,
    timestamp: toUtcDate(e.bookTs),
    properties: {
      ...e.attribution,
      session_id: Number(e.sessionId),
      session_booking_id: Number(e.sessionBookingId),
      backfilled: true,
    },
  });
}
await posthog.shutdown();
console.log(`\nEmitted ${toEmit.length} ${BACKFILL_EVENT} events.`);
