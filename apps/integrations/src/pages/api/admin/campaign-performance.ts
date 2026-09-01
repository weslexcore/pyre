// Campaign performance report, ported from the landing-page admin. Short-link
// clicks come from the shared Upstash store; visits, signups, and bookings are
// attributed by first-touch utm_campaign in PostHog.
//
// utm_campaign values observed in the wild are free text (e.g. "Instagram Bio
// Links" from hand-built links), while campaigns are stored under their
// slugified name ("instagram-bio-links"). Every campaign value is normalized
// through slugifyCampaign before joining so the variants roll up together.

import {
  getRedis,
  listCampaignsWithLinks,
  listShortLinks,
  slugifyCampaign,
  utmCampaignOfUrl,
} from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import {
  getEventLastSeen,
  isPostHogQueryConfigured,
  queryHogQL,
} from '@/lib/analytics/posthog-query';
import { requirePage } from '@/lib/auth/admin';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const CACHE_PREFIX = 'cache:campaign-perf:';
const CACHE_TTL_SECONDS = 5 * 60;
// Last report that came back with PostHog data intact, kept much longer so a
// transient PostHog outage degrades to stale numbers instead of an empty table.
const LAST_GOOD_PREFIX = 'cache:campaign-perf:last-good:';
const LAST_GOOD_TTL_SECONDS = 7 * 24 * 60 * 60;
const ALLOWED_DAYS = [7, 30, 90];

// PostHog's query pool is slow and flaky (see posthog-query.ts); the function
// has a 60s ceiling (astro.config.mjs), so budget the query and its retries
// under that and leave room for the Redis round-trips.
const QUERY_BUDGET_MS = 45_000;
const PRESENCE_BUDGET_MS = 10_000;
// An event that has not been ingested in this long is treated as missing —
// i.e. an instrumentation gap rather than a quiet stretch.
const PRESENCE_WINDOW_DAYS = 180;
// HogQL silently caps results at 100 rows without an explicit LIMIT.
const ROW_LIMIT = 1000;

// Conversion events attributed via the person's first-touch utm_campaign.
const SIGNUP_INTRO = 'Intro Offer Signup';
const SIGNUP_MAILING = 'Mailing List Signup';
const BOOKING = 'booking_completed';
const CONVERSION_EVENTS = [SIGNUP_INTRO, SIGNUP_MAILING, BOOKING];
// Companion events from the one-off attribution backfill (see apps/integrations
// scripts/backfill-booking-attribution.mts). Counted into the bookings bucket;
// kept out of CONVERSION_EVENTS so the instrumentation-gap check ignores them.
const BOOKING_BACKFILL = 'booking_attribution_backfill';

interface CampaignRow {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
  linkCount: number;
  shortlinks: Array<{ code: string; label: string; clicks: number }>;
  shortlinkClicks: number;
  pageviews: number;
  visitors: number;
  introOfferSignups: number;
  mailingListSignups: number;
  bookings: number;
}

interface PerformanceResponse {
  generatedAt: string;
  days: number;
  cached: boolean;
  /** True when PostHog failed and these are the numbers from the last report
   * that succeeded (see generatedAt); posthog.error carries the failure. */
  stale: boolean;
  campaigns: CampaignRow[];
  unattributed: Array<{ slug: string; pageviews: number; visitors: number }>;
  posthog: { configured: boolean; missingEvents: string[]; error: string | null };
}

const sqlList = (events: readonly string[]) => events.map((e) => `'${e}'`).join(', ');

// Traffic and conversions in a single round-trip. Every query to PostHog's
// personal-API-key pool pays several seconds of queueing and a real chance of a
// 503, regardless of how little data it touches, so the two rollups ride the
// same request as UNION ALL branches (each branch keeps its own plan, and the
// person join stays confined to the conversion side). Rows come back tagged by
// `section`; the `people` column is only meaningful for traffic.
function buildRollupQuery(days: number): string {
  return `
    -- Traffic: pageviews carrying utm_campaign, grouped by campaign value.
    SELECT 'traffic' AS section,
           lower(toString(properties.utm_campaign)) AS campaign,
           event,
           count() AS n,
           count(DISTINCT person_id) AS people
    FROM events
    WHERE event = '$pageview'
      AND properties.utm_campaign IS NOT NULL
      AND properties.utm_campaign != ''
      AND timestamp >= now() - INTERVAL ${days} DAY
    GROUP BY campaign, event
    ORDER BY n DESC
    LIMIT ${ROW_LIMIT}
    UNION ALL
    -- Conversions: first-touch attribution via $initial_utm_campaign, with
    -- the event-level attributed_utm_campaign fallback for bookings whose
    -- campaign was inferred from a same-session click (the booker never
    -- identified on the site, so their person has no first-touch data).
    -- Backfill events count ONLY by their stamped campaign — their person
    -- properties reflect ingestion (backfill run) time, not booking time.
    SELECT 'conversion' AS section,
           lower(if(event = '${BOOKING_BACKFILL}',
             nullif(toString(properties.attributed_utm_campaign), ''),
             coalesce(
               nullif(toString(person.properties.$initial_utm_campaign), ''),
               if(event = '${BOOKING}',
                  nullif(toString(properties.attributed_utm_campaign), ''),
                  NULL)
             ))) AS campaign,
           event,
           count() AS n,
           0 AS people
    FROM events
    WHERE event IN (${sqlList([...CONVERSION_EVENTS, BOOKING_BACKFILL])})
      AND timestamp >= now() - INTERVAL ${days} DAY
      AND campaign IS NOT NULL
      AND campaign != ''
    GROUP BY campaign, event
    ORDER BY n DESC
    LIMIT ${ROW_LIMIT}`;
}

// Which conversion events reach PostHog at all — flags instrumentation gaps
// like booking_completed never arriving. Read from the event-definition
// registry instead of scanning events: a 180-day ClickHouse scan reaches into
// PostHog's cold partitions and reliably blew the query timeout, while the
// registry answers from Postgres in a couple of seconds. Best effort: on
// failure nothing is flagged rather than raising a false alarm.
async function findMissingEvents(): Promise<string[]> {
  try {
    const lastSeen = await getEventLastSeen(CONVERSION_EVENTS, {
      signal: AbortSignal.timeout(PRESENCE_BUDGET_MS),
    });
    const cutoff = Date.now() - PRESENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    return CONVERSION_EVENTS.filter((event) => {
      const seenAt = lastSeen.get(event);
      return !seenAt || seenAt.getTime() < cutoff;
    });
  } catch (err) {
    console.warn('[campaign-performance] event presence check skipped:', err);
    return [];
  }
}

async function buildReport(days: number): Promise<PerformanceResponse> {
  const posthog: PerformanceResponse['posthog'] = {
    configured: isPostHogQueryConfigured(),
    missingEvents: [],
    error: null,
  };

  // slug (lowercase) -> traffic / conversion rollups from PostHog
  const traffic = new Map<string, { pageviews: number; visitors: number }>();
  const conversions = new Map<string, Map<string, number>>();

  const [campaignsWithLinks, shortlinkPage, rollupRows, missingEvents] = await Promise.all([
    listCampaignsWithLinks(),
    listShortLinks(500, 0),
    posthog.configured
      ? queryHogQL(buildRollupQuery(days), {
          signal: AbortSignal.timeout(QUERY_BUDGET_MS),
        }).catch((err: unknown) => {
          posthog.error = err instanceof Error ? err.message : 'PostHog query failed';
          return null;
        })
      : Promise.resolve(null),
    posthog.configured ? findMissingEvents() : Promise.resolve([]),
  ]);
  posthog.missingEvents = missingEvents;

  if (rollupRows) {
    for (const row of rollupRows) {
      const [section, rawSlug, event, count, people] = row as [
        string,
        string,
        string,
        number,
        number,
      ];
      const slug = rawSlug ? slugifyCampaign(rawSlug) : '';
      if (!slug) continue;
      if (section === 'traffic') {
        // Sum across raw variants that slugify to the same campaign. Visitors can
        // double-count a person seen under two variants; acceptable for a report.
        const prev = traffic.get(slug);
        traffic.set(slug, {
          pageviews: (prev?.pageviews ?? 0) + Number(count),
          visitors: (prev?.visitors ?? 0) + Number(people),
        });
      } else {
        // Backfilled attribution counts as a booking. A backfill event only
        // exists for bookings with no attribution of their own, so no double count.
        const bucket = event === BOOKING_BACKFILL ? BOOKING : event;
        const byEvent = conversions.get(slug) ?? new Map<string, number>();
        byEvent.set(bucket, (byEvent.get(bucket) ?? 0) + Number(count));
        conversions.set(slug, byEvent);
      }
    }
  }

  // Group shortlinks by the utm_campaign baked into their destination URL.
  const shortlinksBySlug = new Map<
    string,
    Array<{ code: string; label: string; clicks: number }>
  >();
  for (const link of shortlinkPage.links) {
    const slug = utmCampaignOfUrl(link.url);
    if (!slug) continue;
    const list = shortlinksBySlug.get(slug) ?? [];
    list.push({ code: link.code, label: link.label, clicks: Number(link.clicks) || 0 });
    shortlinksBySlug.set(slug, list);
  }

  const knownSlugs = new Set<string>();
  const campaigns: CampaignRow[] = campaignsWithLinks.map(({ campaign, links }) => {
    const slug = campaign.slug.toLowerCase();
    knownSlugs.add(slug);
    const shortlinks = shortlinksBySlug.get(slug) ?? [];
    const byEvent = conversions.get(slug);
    return {
      id: campaign.id,
      name: campaign.name,
      slug: campaign.slug,
      createdAt: Number(campaign.createdAt),
      linkCount: links.length,
      shortlinks,
      shortlinkClicks: shortlinks.reduce((sum, s) => sum + s.clicks, 0),
      pageviews: traffic.get(slug)?.pageviews ?? 0,
      visitors: traffic.get(slug)?.visitors ?? 0,
      introOfferSignups: byEvent?.get(SIGNUP_INTRO) ?? 0,
      mailingListSignups: byEvent?.get(SIGNUP_MAILING) ?? 0,
      bookings: byEvent?.get(BOOKING) ?? 0,
    };
  });

  // utm_campaign values seen in PostHog with no stored campaign — usually links
  // built by hand outside UTM Assist.
  const unattributed = [...traffic.entries()]
    .filter(([slug]) => !knownSlugs.has(slug))
    .map(([slug, t]) => ({ slug, pageviews: t.pageviews, visitors: t.visitors }))
    .sort((a, b) => b.pageviews - a.pageviews);

  return {
    generatedAt: new Date().toISOString(),
    days,
    cached: false,
    stale: false,
    campaigns,
    unattributed,
    posthog,
  };
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, '/admin/campaigns');
  if (gate instanceof Response) return gate;

  const daysRaw = Number.parseInt(url.searchParams.get('days') ?? '', 10);
  const days = ALLOWED_DAYS.includes(daysRaw) ? daysRaw : 30;

  try {
    const redis = getRedis();
    const cacheKey = `${CACHE_PREFIX}${days}`;

    if (url.searchParams.get('fresh') !== '1') {
      const cachedReport = await redis?.get<PerformanceResponse>(cacheKey);
      if (cachedReport) {
        return new Response(JSON.stringify({ ...cachedReport, cached: true }), {
          status: 200,
          headers: JSON_HEADERS,
        });
      }
    }

    const report = await buildReport(days);
    const lastGoodKey = `${LAST_GOOD_PREFIX}${days}`;

    if (report.posthog.error) {
      // Never cache a failed report as if it were the answer for the next five
      // minutes. Serve the last successful numbers instead, flagged stale, so
      // the page still reads while PostHog recovers.
      const lastGood = await redis?.get<PerformanceResponse>(lastGoodKey);
      const fallback: PerformanceResponse = lastGood
        ? {
            ...lastGood,
            cached: true,
            stale: true,
            posthog: { ...lastGood.posthog, error: report.posthog.error },
          }
        : report;
      return new Response(JSON.stringify(fallback), { status: 200, headers: JSON_HEADERS });
    }

    await Promise.all([
      redis?.set(cacheKey, report, { ex: CACHE_TTL_SECONDS }),
      report.posthog.configured
        ? redis?.set(lastGoodKey, report, { ex: LAST_GOOD_TTL_SECONDS })
        : null,
    ]);

    return new Response(JSON.stringify(report), { status: 200, headers: JSON_HEADERS });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};
