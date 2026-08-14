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
import { PartnerDenied } from './templates/PartnerDenied';
import { PartnerReconciliation } from './templates/PartnerReconciliation';
import { PartnerVerificationRequest } from './templates/PartnerVerificationRequest';
import { PartnerVerified } from './templates/PartnerVerified';
import { ReferralRedeemed } from './templates/ReferralRedeemed';
import { ReferralRewardEarned } from './templates/ReferralRewardEarned';
import { ReviewRequest } from './templates/ReviewRequest';
import { SubClaimedNotice } from './templates/SubClaimedNotice';
import { SubOpenNotice } from './templates/SubOpenNotice';
import { SubRequestNotice } from './templates/SubRequestNotice';
import { UnusedCreditReminder } from './templates/UnusedCreditReminder';
import { WeeklyShifts } from './templates/WeeklyShifts';
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
  'partner-verification-request': PartnerVerificationRequest.PreviewProps,
  'partner-verified': PartnerVerified.PreviewProps,
  'partner-denied': PartnerDenied.PreviewProps,
  'partner-reconciliation': PartnerReconciliation.PreviewProps,
  'referral-redeemed': ReferralRedeemed.PreviewProps,
  'referral-reward-earned': ReferralRewardEarned.PreviewProps,
  'sub-request-notice': SubRequestNotice.PreviewProps,
  'sub-open-notice': SubOpenNotice.PreviewProps,
  'sub-claimed-notice': SubClaimedNotice.PreviewProps,
  'weekly-shifts': WeeklyShifts.PreviewProps,
};
