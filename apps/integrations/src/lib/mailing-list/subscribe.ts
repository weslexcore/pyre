import { upsertResendContact } from '@/lib/email/audience';

// Mailing-list sign-ups from the landing page forms (the footer form, the
// promo popup, partner and link-in-bio pages, the volunteer page). The landing
// page's /api/mailing-list route owns the abuse checks and calls this
// server-to-server.
//
// A sign-up is a Resend contact in the newsletter segment (RESEND_SEGMENT_ID);
// the volunteer list also joins RESEND_VOLUNTEER_SEGMENT_ID when that's set.
// Someone on the suppression list stays unsubscribed: the form has no double
// opt-in, so a sign-up can't prove the owner of the address asked to come
// back, and anyone could type in someone else's. They get the same answer as
// everyone else, so the form never reveals who has opted out.

export const MAILING_LISTS = ['newsletter', 'volunteer'] as const;
export type MailingList = (typeof MAILING_LISTS)[number];

export function isMailingList(value: unknown): value is MailingList {
  return typeof value === 'string' && (MAILING_LISTS as readonly string[]).includes(value);
}

export type SubscribeOutcome =
  | { outcome: 'subscribed'; suppressed: boolean }
  | { outcome: 'unavailable'; reason: string };

export async function subscribeToMailingList({
  email,
  list,
  source,
}: {
  email: string;
  list: MailingList;
  source: string;
}): Promise<SubscribeOutcome> {
  const volunteerSegment = import.meta.env.RESEND_VOLUNTEER_SEGMENT_ID;
  const extraSegmentIds = list === 'volunteer' && volunteerSegment ? [volunteerSegment] : [];
  if (!import.meta.env.RESEND_SEGMENT_ID) {
    // Without the segment a sign-up would never get the newsletter.
    console.error('[Mailing list] RESEND_SEGMENT_ID not configured');
    return { outcome: 'unavailable', reason: 'segment-not-configured' };
  }

  const result = await upsertResendContact({ email }, { extraSegmentIds, joinSegments: true });
  if (result.status === 'skipped') {
    return { outcome: 'unavailable', reason: result.reason };
  }

  console.info(
    `[Mailing list] ${email} ${result.status} (${list} via ${source}${result.suppressed ? ', suppressed' : ''})`
  );
  return { outcome: 'subscribed', suppressed: result.suppressed };
}
