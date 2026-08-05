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
} from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import { isPostHogQueryConfigured, queryHogQL } from '@/lib/analytics/posthog-query';
import { requirePage } from '@/lib/auth/admin';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const CACHE_PREFIX = 'cache:campaign-perf:';
const CACHE_TTL_SECONDS = 5 * 60;
const ALLOWED_DAYS = [7, 30, 90];

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
  campaigns: CampaignRow[];
  unattributed: Array<{ slug: string; pageviews: number; visitors: number }>;
  posthog: { configured: boolean; missingEvents: string[]; error: string | null };
}

function utmCampaignOf(url: string): string | null {
  try {
    const raw = new URL(url).searchParams.get('utm_campaign');
    return raw ? slugifyCampaign(raw) || null : null;
  } catch {
    return null;
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

  const posthogQueries = posthog.configured
    ? Promise.all([
        // Traffic: pageviews carrying utm_campaign, grouped by campaign value.
        queryHogQL(
          `SELECT lower(toString(properties.utm_campaign)) AS campaign,
                  count() AS pageviews,
                  count(DISTINCT person_id) AS visitors
           FROM events
           WHERE event = '$pageview'
             AND properties.utm_campaign IS NOT NULL
             AND properties.utm_campaign != ''
             AND timestamp >= now() - INTERVAL ${days} DAY
           GROUP BY campaign`
        ),
        // Conversions: first-touch attribution via $initial_utm_campaign, with
        // the event-level attributed_utm_campaign fallback for bookings whose
        // campaign was inferred from a same-session click (the booker never
        // identified on the site, so their person has no first-touch data).
        // Backfill events count ONLY by their stamped campaign — their person
        // properties reflect ingestion (backfill run) time, not booking time.
        queryHogQL(
          `SELECT lower(if(event = '${BOOKING_BACKFILL}',
                    nullif(toString(properties.attributed_utm_campaign), ''),
                    coalesce(
                      nullif(toString(person.properties.$initial_utm_campaign), ''),
                      if(event = '${BOOKING}',
                         nullif(toString(properties.attributed_utm_campaign), ''),
                         NULL)
                    ))) AS campaign,
                  event,
                  count() AS conversions
           FROM events
           WHERE event IN (${[...CONVERSION_EVENTS, BOOKING_BACKFILL].map((e) => `'${e}'`).join(', ')})
             AND timestamp >= now() - INTERVAL ${days} DAY
             AND campaign IS NOT NULL
             AND campaign != ''
           GROUP BY campaign, event`
        ),
        // Which conversion events exist at all (any attribution) — used to flag
        // instrumentation gaps like booking_completed never reaching PostHog.
        queryHogQL(
          `SELECT event, count()
           FROM events
           WHERE event IN (${CONVERSION_EVENTS.map((e) => `'${e}'`).join(', ')})
             AND timestamp >= now() - INTERVAL 180 DAY
           GROUP BY event`
        ),
      ])
    : null;

  const [campaignsWithLinks, shortlinkPage, posthogResults] = await Promise.all([
    listCampaignsWithLinks(),
    listShortLinks(500, 0),
    posthogQueries?.catch((err: unknown) => {
      posthog.error = err instanceof Error ? err.message : 'PostHog query failed';
      return null;
    }) ?? Promise.resolve(null),
  ]);

  if (posthogResults) {
    const [trafficRows, conversionRows, presenceRows] = posthogResults;
    // Sum across raw variants that slugify to the same campaign. Visitors can
    // double-count a person seen under two variants; acceptable for a report.
    for (const row of trafficRows) {
      const [rawSlug, pageviews, visitors] = row as [string, number, number];
      const slug = rawSlug ? slugifyCampaign(rawSlug) : '';
      if (!slug) continue;
      const prev = traffic.get(slug);
      traffic.set(slug, {
        pageviews: (prev?.pageviews ?? 0) + Number(pageviews),
        visitors: (prev?.visitors ?? 0) + Number(visitors),
      });
    }
    for (const row of conversionRows) {
      const [rawSlug, event, count] = row as [string, string, number];
      const slug = rawSlug ? slugifyCampaign(rawSlug) : '';
      if (!slug) continue;
      // Backfilled attribution counts as a booking. A backfill event only
      // exists for bookings with no attribution of their own, so no double count.
      const bucket = event === BOOKING_BACKFILL ? BOOKING : event;
      const byEvent = conversions.get(slug) ?? new Map<string, number>();
      byEvent.set(bucket, (byEvent.get(bucket) ?? 0) + Number(count));
      conversions.set(slug, byEvent);
    }
    const seenEvents = new Set(presenceRows.map((row) => (row as [string, number])[0]));
    posthog.missingEvents = CONVERSION_EVENTS.filter((e) => !seenEvents.has(e));
  }

  // Group shortlinks by the utm_campaign baked into their destination URL.
  const shortlinksBySlug = new Map<
    string,
    Array<{ code: string; label: string; clicks: number }>
  >();
  for (const link of shortlinkPage.links) {
    const slug = utmCampaignOf(link.url);
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
    await redis?.set(cacheKey, report, { ex: CACHE_TTL_SECONDS });

    return new Response(JSON.stringify(report), { status: 200, headers: JSON_HEADERS });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};
