// Per-session-type copy for the confirmation email — the single source of truth.
//
// One entry per canonical session type (the values produced by `TAG_TO_TYPE` in
// `src/lib/momence-events.ts`). Types without an entry fall back to
// DEFAULT_CONTENT. Edit a type's copy here; the shared structure lives in the
// single `ConfirmationEmail` component.

import type { EmailBackground } from '@/emails/components/EmailLayout';
import type { FaqItem } from '@/emails/types';
import { DEFAULT_FAQS, FAQS_BY_TYPE } from './faq-content';

export interface ConfirmationContent {
  /** Main heading, e.g. "You're in!". */
  headingText: string;
  /** Type-specific paragraph shown after the shared "You're all set…" line. */
  introBody: string;
  /** Stock header image filename under `${ASSET_BASE}/`. */
  headerImage: string;
  /** EmailLayout background; defaults to 'clouds' when omitted. */
  background?: EmailBackground;
  faqs: FaqItem[];
}

const DEFAULT_HEADER = 'confirmation-header.jpg';

const DEFAULT_CONTENT: ConfirmationContent = {
  headingText: "You're booked",
  introBody: "We've got your session reserved. Arrive anytime during the first hour of your session.",
  headerImage: DEFAULT_HEADER,
  faqs: DEFAULT_FAQS,
};

export const CONFIRMATION_CONTENT: Record<string, ConfirmationContent> = {
  guided: {
    headingText: "You're in!",
    introBody:
      'A facilitator will lead you through the experience. Please arrive 10-15 minutes early so you have time to settle in.',
    headerImage: 'guided-confirmation-header.jpg',
    faqs: FAQS_BY_TYPE.guided,
  },
  social: {
    headingText: "You're in!",
    introBody: 'Social sessions are a lively, communal sweat - bring a friend or come meet one.',
    headerImage: 'social-confirmation-header.jpg',
    background: 'lamps',
    faqs: FAQS_BY_TYPE.social,
  },
  'special event': {
    headingText: "You're in!",
    introBody:
      'Arrive 10-15 minutes early to check in, get changed, and settle in before things kick off.',
    headerImage: DEFAULT_HEADER,
    faqs: FAQS_BY_TYPE['special event'],
  },
  'open hours': {
    headingText: "You're booked",
    introBody: "We've got your session reserved. Arrive anytime during the first hour of your session.",
    headerImage: DEFAULT_HEADER,
    faqs: FAQS_BY_TYPE['open hours'],
  },
  yoga: {
    headingText: "You're in!",
    introBody:
      'Arrive 10-15 minutes early to check in and get changed before class. Roll out your mat and settle in.',
    headerImage: DEFAULT_HEADER,
    faqs: FAQS_BY_TYPE.yoga,
  },
  fitness: {
    headingText: "You're in!",
    introBody: 'Arrive 10-15 minutes early to check in and get changed before class.',
    headerImage: DEFAULT_HEADER,
    faqs: FAQS_BY_TYPE.fitness,
  },
  'sound bath': {
    headingText: "You're in!",
    introBody:
      'Arrive 10-15 minutes early to check in and get settled. Find a comfortable spot to lie back and let the sound carry you.',
    headerImage: DEFAULT_HEADER,
    faqs: FAQS_BY_TYPE['sound bath'],
  },
};

/** Returns the confirmation copy for a session type, or DEFAULT_CONTENT. */
export function getConfirmationContent(sessionType: string): ConfirmationContent {
  return CONFIRMATION_CONTENT[sessionType] ?? DEFAULT_CONTENT;
}
