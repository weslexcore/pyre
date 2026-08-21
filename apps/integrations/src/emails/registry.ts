import type { ComponentType } from 'react';
import { ConfirmationEmail } from './components/ConfirmationEmail';
import { CreditExpiryReminder } from './templates/CreditExpiryReminder';
import { CreditPackPitch } from './templates/CreditPackPitch';
import { FirstTimerWelcome } from './templates/FirstTimerWelcome';
import { IncidentReported } from './templates/IncidentReported';
import { IntroFollowUp } from './templates/IntroFollowUp';
import { MembershipPitch } from './templates/MembershipPitch';
import { PartnerDenied } from './templates/PartnerDenied';
import { PartnerReconciliation } from './templates/PartnerReconciliation';
import { PartnerVerificationRequest } from './templates/PartnerVerificationRequest';
import { PartnerVerified } from './templates/PartnerVerified';
import { ReferralRedeemed } from './templates/ReferralRedeemed';
import { ReferralRewardEarned } from './templates/ReferralRewardEarned';
import { ReviewRequest } from './templates/ReviewRequest';
import { ShiftRequestDecision } from './templates/ShiftRequestDecision';
import { SubClaimedNotice } from './templates/SubClaimedNotice';
import { SubOpenNotice } from './templates/SubOpenNotice';
import { SubRequestNotice } from './templates/SubRequestNotice';
import { UnusedCreditReminder } from './templates/UnusedCreditReminder';
import { WeeklyShifts } from './templates/WeeklyShifts';
import type { EmailPropsByTemplate, EmailTemplateKey } from './types';

interface TemplateEntry<K extends EmailTemplateKey> {
  subject: (props: EmailPropsByTemplate[K]) => string;
  Component: ComponentType<EmailPropsByTemplate[K]>;
}

type Registry = { [K in EmailTemplateKey]: TemplateEntry<K> };

// Single source of truth: template key -> subject builder + component.
// Add a template here and to EmailPropsByTemplate (types.ts) to register a new email.
export const EMAIL_TEMPLATES: Registry = {
  confirmation: {
    subject: (p) => `You're booked: ${p.sessionTitle}`,
    Component: ConfirmationEmail,
  },
  'first-timer-welcome': {
    subject: () => 'Welcome to Pyre - what to expect',
    Component: FirstTimerWelcome,
  },
  'intro-follow-up': {
    subject: (p) => `How was it, ${p.firstName}?`,
    Component: IntroFollowUp,
  },
  'credit-pack-pitch': {
    subject: () => 'Make the sauna a ritual - credit packs',
    Component: CreditPackPitch,
  },
  'membership-pitch': {
    subject: () => 'Founding memberships - lock in your rate for life',
    Component: MembershipPitch,
  },
  'review-request': {
    subject: () => 'Mind sharing the heat?',
    Component: ReviewRequest,
  },
  'credit-expiry-reminder': {
    subject: (p) => `Your ${p.creditsLabel} expire ${p.expiresOn}`,
    Component: CreditExpiryReminder,
  },
  'unused-credit-reminder': {
    subject: (p) => `You still have ${p.creditsLabel} at Pyre`,
    Component: UnusedCreditReminder,
  },
  'partner-verification-request': {
    subject: (p) => `Membership check: ${p.customerName} - Pyre x ${p.partnerName}`,
    Component: PartnerVerificationRequest,
  },
  'partner-verified': {
    subject: (p) => `You're verified - ${p.discountPercent}% off at Pyre`,
    Component: PartnerVerified,
  },
  'partner-denied': {
    subject: () => 'About your Pyre partner discount request',
    Component: PartnerDenied,
  },
  'partner-reconciliation': {
    subject: (p) => `Quarterly member check - Pyre x ${p.partnerName}`,
    Component: PartnerReconciliation,
  },
  'referral-redeemed': {
    subject: (p) => `${p.referrerName} gave you ${p.discountPercent}% off at Pyre`,
    Component: ReferralRedeemed,
  },
  'referral-reward-earned': {
    subject: (p) => `${p.friendFirstName} booked - your Pyre reward is live`,
    Component: ReferralRewardEarned,
  },
  'sub-request-notice': {
    subject: (p) => `${p.staffName} needs a sub: ${p.shiftLabel} on ${p.dateLabel}`,
    Component: SubRequestNotice,
  },
  'sub-open-notice': {
    subject: (p) => `Can you cover ${p.shiftLabel} on ${p.dateLabel}?`,
    Component: SubOpenNotice,
  },
  'sub-claimed-notice': {
    subject: (p) => `${p.takerName} is covering ${p.shiftLabel} on ${p.dateLabel}`,
    Component: SubClaimedNotice,
  },
  'weekly-shifts': {
    subject: (p) => `Your shifts this week — ${p.weekLabel}`,
    Component: WeeklyShifts,
  },
  'shift-request-decision': {
    subject: (p) =>
      p.decision === 'approved'
        ? `You're on: ${p.shiftLabel} on ${p.dateLabel}`
        : `Shift request update: ${p.shiftLabel} on ${p.dateLabel}`,
    Component: ShiftRequestDecision,
  },
  'incident-reported': {
    subject: (p) =>
      `${p.severityLabel} incident: ${p.categoryLabel} in the ${p.areaLabel} (${p.reference})`,
    Component: IncidentReported,
  },
};

export type { EmailTemplateKey };
