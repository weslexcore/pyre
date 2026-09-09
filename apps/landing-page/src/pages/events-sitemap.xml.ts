// Sitemap for the per-event pages.
//
// @astrojs/sitemap only sees routes that exist at build time, so the SSR
// /events/<id>-<slug> pages never make it into sitemap-index.xml. This endpoint
// lists them at request time; robots.txt points crawlers at it alongside the
// generated index.
//
// It lists one URL per *distinct* session rather than every occurrence. The
// calendar is overwhelmingly recurring — of ~180 upcoming sessions, ~165 are
// "Open Hours" with identical title, description and image, differing only by
// start time. Handing Google 165 near-identical pages spends crawl budget on
// duplicates and buries the handful of special events that have real search
// value, so recurring sessions collapse to their next occurrence.
//
// Omitting an occurrence costs nothing: a sitemap is a discovery hint, not a
// gate. Every session stays linked from /events and remains crawlable and
// indexable — this only says which pages are worth looking at first.

import type { APIRoute } from 'astro';
import { buildPooledBookingModel } from '@/lib/booking-model';
import { eventPath } from '@/lib/event-url';
import {
  excludeVolunteerEvents,
  fetchMomenceEvents,
  filterValidEvents,
  sortEventsByDate,
  transformToEventItem,
} from '@/lib/momence';

export const prerender = false;

export const GET: APIRoute = async ({ site }) => {
  const origin = site?.origin ?? 'https://pyresauna.com';

  // The teacher roster only feeds practitioner bylines, so the sitemap skips
  // that fetch entirely.
  const events = sortEventsByDate(
    excludeVolunteerEvents(filterValidEvents(await fetchMomenceEvents()))
  ).map((raw) => transformToEventItem(raw));

  // fetchMomenceEvents() resolves to [] on failure rather than throwing, and
  // Pyre always has sessions on the calendar — so an empty list means the fetch
  // failed. Say so instead of publishing an empty sitemap, and don't cache it.
  if (events.length === 0) {
    return new Response('Events are temporarily unavailable', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  // Full-length pooled sessions that only exist to back an entry slot's duration
  // option are hidden from the schedule; they're a booking-model detail, not a
  // page worth advertising.
  const { hiddenIds } = buildPooledBookingModel(events);

  // Events arrive sorted by date, so the first occurrence of a title is the
  // soonest one.
  const seenTitles = new Set<string>();
  const canonical = events.filter((event) => {
    if (hiddenIds.has(event.id)) return false;
    const key = event.title.trim().toLowerCase();
    if (seenTitles.has(key)) return false;
    seenTitles.add(key);
    return true;
  });

  // `loc` is built from eventPath(), whose output is digits and slug characters
  // only, so there is nothing here that needs XML escaping.
  //
  // No lastmod: the honest value would be when the session's copy last changed,
  // which Momence doesn't expose. Its start date is in the future and a future
  // lastmod is a signal Google distrusts, and stamping "now" on every request is
  // no more truthful. changefreq and priority are omitted for the same reason —
  // Google ignores both outright.
  const urls = canonical
    .map((event) => `  <url>\n    <loc>${origin}${eventPath(event)}</loc>\n  </url>`)
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // The calendar moves daily, so this is cached far more tightly than the
      // static llms.txt/robots.txt endpoints.
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
};
