import { getTagIdByName } from '@/lib/momence/host-api';
import { defineStep, type Journey } from '../types';

// Ask regulars (4+ checked-in visits) for a Google review — once per lifetime.
// Staff control the audience from inside Momence via tags:
//   "Google Review"    -> they already reviewed; never ask
//   "Review Requested" -> written back by this journey on completion (also
//                         excluded, belt-and-braces on top of the enrollment
//                         unique constraint)

const ALREADY_REVIEWED_TAG = 'Google Review';
const REQUESTED_TAG = 'Review Requested';

function getReviewUrl(): string {
  // Source: apps/social/posts/google-review-card (the QR postcard).
  // Deliberately NO utm params: it's a Google deep link we don't control —
  // extra query params can break the write-a-review flow, and we get click
  // attribution from Resend's click webhook instead.
  return import.meta.env.GOOGLE_REVIEW_URL ?? 'https://g.page/r/CbPLgfm6vte6EAI/review';
}

export const reviewRequest: Journey = {
  id: 'review-request',
  kind: 'marketing',
  enroll: {
    source: 'sweep',
    async audience() {
      const excludeTags = (
        await Promise.all([getTagIdByName(ALREADY_REVIEWED_TAG), getTagIdByName(REQUESTED_TAG)])
      ).filter((id): id is number => id !== null);

      return {
        filter: {
          type: 'and',
          // Server-side: 4+ visits, minus anyone carrying an exclusion tag.
          visits: { count: { type: 'moreThan', value: 3 } },
          ...(excludeTags.length > 0 && {
            customerTags: {
              type: 'and' as const,
              customerHaveTag: 'not-have' as const,
              tags: excludeTags,
            },
          }),
        },
        // The visits filter may count bookings; require actual check-ins.
        predicate: async (member) => member.visits.totalVisits >= 4,
      };
    },
  },
  completionTag: REQUESTED_TAG,
  steps: [
    defineStep({
      id: 'ask',
      delayHours: 1, // small buffer so a dry-run/enroll mistake is catchable
      template: 'review-request',
      props: async (ctx) => ({ firstName: ctx.firstName, reviewUrl: getReviewUrl() }),
    }),
  ],
};
