// STRUCTURE-ONLY STUB — not wired up yet.
//
// Future: tag-based email journeys (drip sequences). A member's Momence/Mailchimp
// tags enroll them into a journey; each step waits a delay then sends a template.
//
// NOTE: journeys are MARKETING email (unlike transactional confirmations) and
// will require unsubscribe handling + compliance, and a Resend-vs-Mailchimp
// decision, before going live.

import type { EmailTemplateKey } from '@/emails/registry';

export interface JourneyStep {
  /** Delay after enrollment (or previous step) before sending, in hours. */
  delayHours: number;
  template: EmailTemplateKey;
}

export interface Journey {
  id: string;
  /** Momence/Mailchimp tag that enrolls a member into this journey. */
  enrollTag: string;
  steps: JourneyStep[];
}
