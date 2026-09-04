// Confirmation-email FAQ copy, keyed by session type.
//
// Session-type keys match the canonical types produced by `TAG_TO_TYPE` in
// `src/lib/momence-events.ts` (e.g. 'guided', 'social', 'special event',
// 'open hours', 'fitness', 'sound bath', …). Types not listed in FAQS_BY_TYPE
// fall back to DEFAULT_FAQS, so every confirmation always shows a sensible FAQ
// block.

import type { FaqItem } from '@/emails/types';

// Keyed so sessions needing a yoga mat (e.g. fitness classes) swap the swimsuit
// line for the mat line. Default to `regular`; use `yoga` where a mat is needed.
const WHAT_TO_BRING: Record<string, FaqItem> = {
  regular: {
    question: 'What should I bring?',
    answer:
      'Bring a swimsuit, a water bottle and an optional robe. We recommend sandals — much of our space is bare ground and stone. We provide towels for your session.',
  },
  yoga: {
    question: 'What should I bring?',
    answer:
      'Bring a yoga mat, bathing suit, water bottle and an optional robe. We recommend sandals — much of our space is bare ground and stone. We provide towels for your session.',
  },
};

const SAUNA_TEMP: FaqItem = {
  question: 'How hot does the sauna get?',
  answer: 'Our traditional Finnish saunas reach temperatures between 170-195°F.',
};

const SAUNA_PLUNGE_TIMING: FaqItem = {
  question: 'How long should I stay in the sauna and cold plunge?',
  answer:
    'We recommend 10-20 minute sauna sessions followed by 1-3 minute cold plunge immersions. Repeat 2-4 rounds for optimal benefits.',
};

// Shared first-timer FAQ items (mirrors the first-timer welcome email) appended
// to every confirmation set so even returning guests have the basics on hand.
const HAVE_QUESTIONS: FaqItem = {
  question: 'What if I have questions?',
  answer:
    "We are two of America's first certified sauna masters and are here to help you get the most out of your session. If at any point you have questions, just let us know — we're always happy to provide guidance.",
};

/**
 * Parking directions. The confirmation email prints this right under the
 * address on its details card (so it's not repeated in that email's FAQ); the
 * first-timer welcome still carries it as a question.
 */
export const PARKING_DIRECTIONS =
  'Street parking is available on Westover Hills Blvd. and W 49th St. You can also park in the gravel lot off W 49th St. (look for the big Pyre sign on our sauna) or in the lot off Westover Hills Blvd. marked by the Living Water sign.';

const PARKING: FaqItem = {
  question: 'Where should I park?',
  answer: PARKING_DIRECTIONS,
};

const CANCELLATION: FaqItem = {
  question: 'What if I need to cancel?',
  answer:
    'Cancel at least 2 hours before your session starts and your credits will be returned to your account. Cancellations within 2 hours of start time are not eligible for credit back.',
};

/**
 * The most-asked cancellation question. The confirmation also states the
 * one-line version in its body (ConfirmationEmail.tsx) — keep the two in step.
 */
export const WEATHER_POLICY =
  "We're open rain or shine and only cancel for thunder, lightning, or other extreme weather. If weather ends your session before you've completed at least three-quarters of it, we refund your credits.";

const WEATHER: FaqItem = {
  question: 'What happens in bad weather?',
  answer: WEATHER_POLICY,
};

// Shared items appended to the end of every confirmation FAQ set. Parking and
// arrival time are deliberately absent: the confirmation's details card shows
// both next to the address and start time, where guests actually look.
const FIRST_TIMER_TAIL: FaqItem[] = [HAVE_QUESTIONS, CANCELLATION, WEATHER];

/**
 * Curated FAQ set sent with the first-timer welcome email. Kept here (rather
 * than imported from landing-page, a separate workspace) so all email FAQ copy
 * lives in one place.
 */
export const FIRST_TIMER_FAQS: FaqItem[] = [
  WHAT_TO_BRING['regular'],
  HAVE_QUESTIONS,
  SAUNA_TEMP,
  SAUNA_PLUNGE_TIMING,
  PARKING,
  CANCELLATION,
  WEATHER,
];

/** Used for open hours and any session type without a bespoke set. */
export const DEFAULT_FAQS: FaqItem[] = [
  WHAT_TO_BRING['regular'],
  // SAUNA_TEMP,
  // SAUNA_PLUNGE_TIMING,
  ...FIRST_TIMER_TAIL,
];

/** Bespoke FAQ sets per session type. */
export const FAQS_BY_TYPE: Record<string, FaqItem[]> = {
  'open hours': [WHAT_TO_BRING['regular'], ...FIRST_TIMER_TAIL],
  // Yoga and other fitness classes (pilates, etc.) need a mat, not a swimsuit.
  yoga: [WHAT_TO_BRING['yoga'], ...FIRST_TIMER_TAIL],
  fitness: [WHAT_TO_BRING['yoga'], ...FIRST_TIMER_TAIL],
  // Sound baths are lie-down sessions, so guests bring a mat.
  'sound bath': [WHAT_TO_BRING['yoga'], ...FIRST_TIMER_TAIL],
  guided: [
    WHAT_TO_BRING['regular'],
    {
      question: 'What happens during a guided session?',
      answer:
        'One of our sauna masters will lead you through rounds of sauna and cold plunge, guiding the breath and pacing so you can relax and get the most out of the experience.',
    },
    // SAUNA_PLUNGE_TIMING,
    ...FIRST_TIMER_TAIL,
  ],
  social: [
    WHAT_TO_BRING['regular'],
    {
      question: 'What is a social session like?',
      answer:
        'Social sessions are a lively, communal sweat — come meet new people or bring a friend. Expect a relaxed, conversational atmosphere.',
    },
    // SAUNA_TEMP,
    ...FIRST_TIMER_TAIL,
  ],
  'special event': [
    WHAT_TO_BRING['regular'],
    // SAUNA_TEMP,
    // SAUNA_PLUNGE_TIMING,
    ...FIRST_TIMER_TAIL,
  ],
};

/** Returns the bespoke FAQ set for a session type, or DEFAULT_FAQS. */
export function getFaqsForSessionType(sessionType: string): FaqItem[] {
  return FAQS_BY_TYPE[sessionType] ?? DEFAULT_FAQS;
}
