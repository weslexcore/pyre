// Per-template prop interfaces and the template -> props map that keeps the
// registry, sendTemplate(), and call sites type-safe.

export interface ConfirmationEmailProps {
  firstName: string;
  sessionTitle: string;
  dateLabel: string;
  timeLabel: string;
  location: string;
  // manageUrl: string;
  /** The booked event's own image; falls back to a stock header without it. */
  sessionImageUrl?: string;
  /** Canonical session type; selects the per-type copy in confirmation-content.ts. */
  sessionType: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface FirstTimerEmailProps {
  firstName: string;
  faqs: FaqItem[];
  // manageUrl: string;
  directionsUrl: string;
}

// Marketing templates all carry unsubscribeUrl — sendTemplate() injects it for
// kind: 'marketing' sends and EmailLayout renders it in the footer.
export interface MarketingEmailBaseProps {
  firstName: string;
  unsubscribeUrl?: string;
}

export type IntroFollowUpProps = MarketingEmailBaseProps;

export type CreditPackPitchProps = MarketingEmailBaseProps;

export type MembershipPitchProps = MarketingEmailBaseProps;

export interface ReviewRequestProps extends MarketingEmailBaseProps {
  reviewUrl: string;
}

export interface CreditExpiryReminderProps extends MarketingEmailBaseProps {
  /** e.g. "3 credits" or "$50 in credit" */
  creditsLabel: string;
  /** e.g. "August 12" */
  expiresOn: string;
  daysLeft: number;
}

export interface UnusedCreditReminderProps extends MarketingEmailBaseProps {
  /** e.g. "2 credits" or "$25 in credit" */
  creditsLabel: string;
}

// Partner verification lifecycle (all transactional — no unsubscribeUrl).

export interface PartnerVerificationRequestProps {
  partnerName: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  partnerMemberEmail: string | null;
  confirmUrl: string;
  denyUrl: string;
  expiresDays: number;
}

export interface PartnerVerifiedProps {
  firstName: string;
  partnerName: string;
  discountPercent: number;
  bookUrl: string;
}

export interface PartnerDeniedProps {
  firstName: string;
  partnerName: string;
  /** 'denied' = partner said no; 'expired' = nobody responded in time. */
  reason: 'denied' | 'expired';
}

export interface PartnerReconciliationProps {
  partnerName: string;
  /** e.g. "2026-q3" */
  quarterLabel: string;
  members: { name: string; email: string }[];
}

export interface EmailPropsByTemplate {
  confirmation: ConfirmationEmailProps;
  'first-timer-welcome': FirstTimerEmailProps;
  'intro-follow-up': IntroFollowUpProps;
  'credit-pack-pitch': CreditPackPitchProps;
  'membership-pitch': MembershipPitchProps;
  'review-request': ReviewRequestProps;
  'credit-expiry-reminder': CreditExpiryReminderProps;
  'unused-credit-reminder': UnusedCreditReminderProps;
  'partner-verification-request': PartnerVerificationRequestProps;
  'partner-verified': PartnerVerifiedProps;
  'partner-denied': PartnerDeniedProps;
  'partner-reconciliation': PartnerReconciliationProps;
}

export type EmailTemplateKey = keyof EmailPropsByTemplate;
