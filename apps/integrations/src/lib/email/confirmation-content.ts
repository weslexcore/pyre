// Per-session-type copy for the confirmation email — the single source of truth.
//
// One entry per canonical session type (the values produced by `TAG_TO_TYPE` in
// `src/lib/momence-events.ts`). Types without an entry fall back to
// DEFAULT_CONTENT. Edit a type's copy here; the shared structure lives in the
// single `ConfirmationEmail` component.

import type { EmailBackground } from '@/emails/components/EmailLayout';
import type { FaqItem } from '@/emails/types';
import type { ArrivalPolicy } from './arrival';
import { DEFAULT_FAQS, FAQS_BY_TYPE } from './faq-content';

export interface ConfirmationContent {
  /** Main heading, e.g. "You're in!". */
  headingText: string;
  /** Type-specific paragraph shown after the shared "You're all set…" line. */
  introBody: string;
  /**
   * When guests should show up; turned into a clock time on the details card
   * (see lib/email/arrival.ts). 'early' = be here before start; 'late' =
   * anytime in the first hour.
   */
  arrival: ArrivalPolicy;
  /** Stock header image filename under `${ASSET_BASE}/`. */
  headerImage: string;
  /** EmailLayout background; defaults to 'clouds' when omitted. */
  background?: EmailBackground;
  faqs: FaqItem[];
}

/**
 * The one venue, split into lines the details card can stack. Momence's
 * `event.location` is usually just the venue name, so the street address is
 * always rendered from here rather than trusted to arrive with the event.
 */
export const VENUE = {
  name: 'Pyre Sauna',
  /** The property we share; the sign guests will actually see from the road. */
  landmark: 'at Living Water',
  street: '1000 Westover Hills Blvd',
  cityStateZip: 'Richmond, VA 23225',
} as const;

const VENUE_QUERY = encodeURIComponent(`${VENUE.name}, ${VENUE.street}, ${VENUE.cityStateZip}`);

/** Google Maps directions link used across booking emails. */
export const DIRECTIONS_URL = `https://www.google.com/maps/search/?api=1&query=${VENUE_QUERY}`;

/** Apple Maps equivalent, for the iPhone default. */
export const APPLE_MAPS_URL = `https://maps.apple.com/?q=${VENUE_QUERY}`;

/**
 * Lines for the "Where" block. Anything that looks like our own venue (empty,
 * the Momence default "Pyre Sauna", or our street) collapses to the canonical
 * name + address; an off-site location is shown verbatim.
 */
export function locationLines(location: string | undefined): string[] {
  const trimmed = location?.trim() ?? '';
  const isVenue = trimmed === '' || /pyre/i.test(trimmed) || /westover/i.test(trimmed);
  if (isVenue) return [`${VENUE.name} ${VENUE.landmark}`, VENUE.street, VENUE.cityStateZip];
  return [trimmed];
}

const DEFAULT_HEADER = 'confirmation-header.jpg';

const DEFAULT_CONTENT: ConfirmationContent = {
  headingText: "You're booked",
  introBody:
    "We've got your spot reserved. Sauna, plunge, and rest at your own pace - stay as long as you like through the end of the session.",
  arrival: 'late',
  headerImage: DEFAULT_HEADER,
  faqs: DEFAULT_FAQS,
};

export const CONFIRMATION_CONTENT: Record<string, ConfirmationContent> = {
  guided: {
    headingText: "You're in!",
    introBody:
      'One of our sauna masters will lead you through rounds of sauna and cold plunge - all you need to do is show up, get changed, and settle in.',
    arrival: 'early',
    headerImage: 'guided-confirmation-header.jpg',
    faqs: FAQS_BY_TYPE.guided,
  },
  social: {
    headingText: "You're in!",
    introBody: 'Social sessions are a lively, communal sweat - bring a friend or come meet one.',
    arrival: 'late',
    headerImage: 'social-confirmation-header.jpg',
    background: 'lamps',
    faqs: FAQS_BY_TYPE.social,
  },
  'special event': {
    headingText: "You're in!",
    introBody:
      "We'll have everything ready for you - just check in, get changed, and settle in before things kick off.",
    arrival: 'early',
    headerImage: DEFAULT_HEADER,
    faqs: FAQS_BY_TYPE['special event'],
  },
  'open hours': {
    headingText: "You're booked",
    introBody:
      "We've got your spot reserved. Sauna, plunge, and rest at your own pace - stay as long as you like through the end of the session.",
    arrival: 'late',
    headerImage: DEFAULT_HEADER,
    faqs: FAQS_BY_TYPE['open hours'],
  },
  yoga: {
    headingText: "You're in!",
    introBody: 'Check in, get changed, roll out your mat, and settle in before class begins.',
    arrival: 'early',
    headerImage: DEFAULT_HEADER,
    faqs: FAQS_BY_TYPE.yoga,
  },
  fitness: {
    headingText: "You're in!",
    introBody: 'Check in, get changed, and settle in before class begins.',
    arrival: 'early',
    headerImage: DEFAULT_HEADER,
    faqs: FAQS_BY_TYPE.fitness,
  },
  'sound bath': {
    headingText: "You're in!",
    introBody: 'Find a comfortable spot to lie back and let the sound carry you.',
    arrival: 'early',
    headerImage: DEFAULT_HEADER,
    faqs: FAQS_BY_TYPE['sound bath'],
  },
};

/** Canonical session types with dedicated confirmation copy (admin preview presets). */
export const CONFIRMATION_SESSION_TYPES = Object.keys(CONFIRMATION_CONTENT);

/** Returns the confirmation copy for a session type, or DEFAULT_CONTENT. */
export function getConfirmationContent(sessionType: string): ConfirmationContent {
  return CONFIRMATION_CONTENT[sessionType] ?? DEFAULT_CONTENT;
}
