import type { APIRoute } from 'astro';
import { verifyCalendarToken } from '@/lib/calendar/event-token';
import { generateIcs } from '@/lib/calendar/ics';
import { buildEventDescription, VENUE_ADDRESS } from '@/lib/calendar/links';

export const prerender = false;

// Hosted .ics for the "Apple" add-to-calendar link in confirmation emails
// (also serves desktop Outlook/Thunderbird). Stateless: all event data lives
// in the HMAC-signed `d` token, so links keep working after the session drops
// off the Momence upcoming-events feed. The signature is the auth gate.
export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('d');
  const payload = token ? verifyCalendarToken(token) : null;
  if (!payload) {
    return new Response('Invalid or expired link', { status: 400 });
  }

  const ics = generateIcs({
    title: payload.title,
    startIso: payload.start,
    endIso: payload.end,
    location: VENUE_ADDRESS,
    description: buildEventDescription(payload.title),
    url: 'https://pyresauna.com',
  });

  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="pyre-sauna.ics"',
      // Deterministic per token (modulo DTSTAMP) — a day of caching is fine.
      'Cache-Control': 'public, max-age=86400',
    },
  });
};
