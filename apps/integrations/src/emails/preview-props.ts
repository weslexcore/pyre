// Default props for the admin email-template browser (/admin/email-templates).
// One entry per registered template, reusing the same sample data the React
// Email dev server (`yarn email`) renders with, so the two previews agree.
// Typed against EmailPropsByTemplate so it cannot drift from the registry.

import { sampleConfirmationProps } from './components/ConfirmationEmail';
import { CreditExpiryReminder } from './templates/CreditExpiryReminder';
import { CreditPackPitch } from './templates/CreditPackPitch';
import { FirstTimerWelcome } from './templates/FirstTimerWelcome';
import { IntroFollowUp } from './templates/IntroFollowUp';
import { MembershipPitch } from './templates/MembershipPitch';
import { ReviewRequest } from './templates/ReviewRequest';
import { UnusedCreditReminder } from './templates/UnusedCreditReminder';
import type { EmailPropsByTemplate } from './types';

export const EMAIL_PREVIEW_PROPS: { [K in keyof EmailPropsByTemplate]: EmailPropsByTemplate[K] } = {
  confirmation: sampleConfirmationProps,
  'first-timer-welcome': FirstTimerWelcome.PreviewProps,
  'intro-follow-up': IntroFollowUp.PreviewProps,
  'credit-pack-pitch': CreditPackPitch.PreviewProps,
  'membership-pitch': MembershipPitch.PreviewProps,
  'review-request': ReviewRequest.PreviewProps,
  'credit-expiry-reminder': CreditExpiryReminder.PreviewProps,
  'unused-credit-reminder': UnusedCreditReminder.PreviewProps,
};
