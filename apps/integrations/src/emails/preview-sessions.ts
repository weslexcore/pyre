// Sample confirmations for the previews (`yarn email`, /admin/email-templates).
//
// Every entry is run through the same helpers a real send uses
// (buildResolvedSession -> buildConfirmationProps), so the date, time, zone,
// arrival line and calendar links are generated, never hand-written. Change a
// formatting rule and the previews follow automatically.

import { buildConfirmationProps } from '@/lib/email/confirmation-props';
import { buildResolvedSession, type SessionFacts } from '@/lib/momence-events';
import type { ConfirmationEmailProps } from './types';

const PREVIEW_FIRST_NAME = 'Julien';

/** Sat, June 20 2026, 10:00 AM America/New_York. */
const SATURDAY_10AM = '2026-06-20T14:00:00.000Z';
const SATURDAY_9AM = '2026-06-20T13:00:00.000Z';
const SATURDAY_6PM = '2026-06-20T22:00:00.000Z';
const SATURDAY_630PM = '2026-06-20T22:30:00.000Z';
const SATURDAY_7PM = '2026-06-20T23:00:00.000Z';

function preview(facts: Omit<SessionFacts, 'isLastOfDay'> & { isLastOfDay?: boolean }) {
  return buildConfirmationProps(
    PREVIEW_FIRST_NAME,
    buildResolvedSession({ isLastOfDay: false, ...facts })
  );
}

/**
 * One preview per session type with dedicated copy (the keys of
 * CONFIRMATION_CONTENT), which is also what the admin preset chips offer.
 */
export const CONFIRMATION_PREVIEWS: Record<string, ConfirmationEmailProps> = {
  guided: preview({
    sessionType: 'guided',
    title: 'Signature Guided Class',
    startIso: SATURDAY_10AM,
    durationMinutes: 120,
    imageUrl:
      'https://images.momence.com/h/169530/session-template-banner/d0db75ba-775b-4335-84f8-2e6a7f28b8a3.webp',
  }),
  social: preview({
    sessionType: 'social',
    title: 'Social Evening w/ Boy Lichtenstein',
    startIso: SATURDAY_6PM,
    durationMinutes: 120,
    imageUrl:
      'https://images.momence.com/h/169530/session-banner/9fec582a-df63-40f2-9754-b4c69f176423.jpeg',
  }),
  'open hours': preview({
    sessionType: 'open hours',
    title: 'Open Hours',
    startIso: SATURDAY_10AM,
    durationMinutes: 120,
  }),
  'special event': preview({
    sessionType: 'special event',
    title: 'Special Event',
    startIso: SATURDAY_630PM,
    durationMinutes: 150,
  }),
  yoga: preview({
    sessionType: 'yoga',
    title: 'Yoga // Sauna // Plunge',
    startIso: SATURDAY_9AM,
    durationMinutes: 75,
    imageUrl:
      'https://images.momence.com/h/169530/session-banner/32f8ce0d-8f97-4ac6-a013-d600c9a73d7d.jpeg',
  }),
  fitness: preview({
    sessionType: 'fitness',
    title: 'Pilates // Sauna // Plunge',
    startIso: SATURDAY_9AM,
    durationMinutes: 75,
  }),
  'sound bath': preview({
    sessionType: 'sound bath',
    title: 'Sound Bath // Sauna // Plunge',
    startIso: SATURDAY_7PM,
    durationMinutes: 90,
  }),
};

/** The last drop-in slot of the day: arrival collapses to the start time. */
export const LAST_SLOT_PREVIEW: ConfirmationEmailProps = preview({
  sessionType: 'open hours',
  title: 'Open Hours',
  startIso: SATURDAY_7PM,
  durationMinutes: 60,
  isLastOfDay: true,
});

/**
 * What sends when the Momence feed can't resolve the booking — no time, no
 * arrival line, no calendar links. Worth previewing: it still goes to guests.
 */
export const UNRESOLVED_PREVIEW: ConfirmationEmailProps = buildConfirmationProps(
  PREVIEW_FIRST_NAME,
  null
);
