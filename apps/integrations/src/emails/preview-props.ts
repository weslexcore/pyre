// Default props for the admin email-template browser (/admin/email-templates).
// One entry per registered template, reusing the same sample data the React
// Email dev server (`yarn email`) renders with, so the two previews agree.
// Typed against EmailPropsByTemplate so it cannot drift from the registry.

import { sampleConfirmationProps } from './components/ConfirmationEmail';
import { AdminMessage } from './templates/AdminMessage';
import { HoursChangeDecision } from './templates/HoursChangeDecision';
import { IncidentReported } from './templates/IncidentReported';
import { JourneyEmail } from './templates/JourneyEmail';
import { LostFoundClaimed } from './templates/LostFoundClaimed';
import { LostFoundFound } from './templates/LostFoundFound';
import { PartnerDenied } from './templates/PartnerDenied';
import { PartnerReconciliation } from './templates/PartnerReconciliation';
import { PartnerVerificationRequest } from './templates/PartnerVerificationRequest';
import { PartnerVerified } from './templates/PartnerVerified';
import { ReferralRedeemed } from './templates/ReferralRedeemed';
import { ReferralRewardEarned } from './templates/ReferralRewardEarned';
import { ScheduleLint } from './templates/ScheduleLint';
import { ShiftRequestDecision } from './templates/ShiftRequestDecision';
import { SubClaimedNotice } from './templates/SubClaimedNotice';
import { SubOpenNotice } from './templates/SubOpenNotice';
import { SubRequestNotice } from './templates/SubRequestNotice';
import { WeeklyShifts } from './templates/WeeklyShifts';
import type { EmailPropsByTemplate } from './types';

export const EMAIL_PREVIEW_PROPS: { [K in keyof EmailPropsByTemplate]: EmailPropsByTemplate[K] } = {
  confirmation: sampleConfirmationProps,
  journey: JourneyEmail.PreviewProps,
  'partner-verification-request': PartnerVerificationRequest.PreviewProps,
  'partner-verified': PartnerVerified.PreviewProps,
  'partner-denied': PartnerDenied.PreviewProps,
  'partner-reconciliation': PartnerReconciliation.PreviewProps,
  'referral-redeemed': ReferralRedeemed.PreviewProps,
  'referral-reward-earned': ReferralRewardEarned.PreviewProps,
  'admin-message': AdminMessage.PreviewProps,
  'sub-request-notice': SubRequestNotice.PreviewProps,
  'sub-open-notice': SubOpenNotice.PreviewProps,
  'sub-claimed-notice': SubClaimedNotice.PreviewProps,
  'weekly-shifts': WeeklyShifts.PreviewProps,
  'shift-request-decision': ShiftRequestDecision.PreviewProps,
  'hours-change-decision': HoursChangeDecision.PreviewProps,
  'incident-reported': IncidentReported.PreviewProps,
  'lost-found-found': LostFoundFound.PreviewProps,
  'lost-found-claimed': LostFoundClaimed.PreviewProps,
  'schedule-lint': ScheduleLint.PreviewProps,
};
