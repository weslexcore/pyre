import { emailLink } from '@/emails/components/utm';
import type { CalendarLinks } from '@/emails/types';
import { createCalendarToken } from './event-token';
import { toIcsUtc } from './ics';

// Add-to-calendar URLs for the booking confirmation email. Google and Outlook
// are provider URL templates; "Apple" (and desktop Outlook/Thunderbird) is our
// hosted .ics endpoint, gated by a signed stateless token.

export const VENUE_ADDRESS = 'Pyre Sauna, 1000 Westover Hills Blvd, Richmond, VA 23225';

/** Composed server-side (not stored in the token) so old links pick up copy fixes. */
export function buildEventDescription(title: string): string {
  return [
    title,
    'Please arrive 10 minutes early.',
    'Need to make a change? Reply to your confirmation email.',
    emailLink('https://pyresauna.com', 'confirmation', 'calendar-event'),
  ].join('\n');
}

export function buildCalendarLinks(args: {
  title: string;
  startIso: string;
  endIso: string;
}): CalendarLinks {
  const { title, startIso, endIso } = args;
  const description = buildEventDescription(title);

  const google = `https://calendar.google.com/calendar/render?${new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${toIcsUtc(startIso)}/${toIcsUtc(endIso)}`,
    location: VENUE_ADDRESS,
    details: description,
  })}`;

  // Outlook wants second-precision ISO timestamps ('2026-06-20T14:00:00Z').
  const outlookIso = (iso: string) => `${new Date(iso).toISOString().slice(0, 19)}Z`;
  const outlook = `https://outlook.live.com/calendar/0/action/compose?${new URLSearchParams({
    rru: 'addevent',
    subject: title,
    startdt: outlookIso(startIso),
    enddt: outlookIso(endIso),
    location: VENUE_ADDRESS,
    body: description,
  })}`;

  const links: CalendarLinks = { google, outlook };

  // No signing secret (e.g. preview envs) -> skip the hosted .ics link; the
  // provider links above still work.
  const token = createCalendarToken({ v: 1, title, start: startIso, end: endIso });
  if (token) {
    const origin = import.meta.env.PUBLIC_EMAIL_ASSET_BASE
      ? new URL(import.meta.env.PUBLIC_EMAIL_ASSET_BASE).origin
      : 'https://pyre-integrations.vercel.app';
    links.ics = `${origin}/api/calendar/event.ics?d=${token}`;
  }

  return links;
}
