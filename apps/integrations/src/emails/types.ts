// Per-template prop interfaces and the template -> props map that keeps the
// registry, sendTemplate(), and call sites type-safe.

// Add-to-calendar URLs, built at send time (lib/calendar/links.ts). `ics` is
// the hosted signed .ics link ("Apple"); absent when no signing secret is set.
export interface CalendarLinks {
  google: string;
  outlook: string;
  ics?: string;
}

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
  /** Absent when the session couldn't be resolved — the row simply doesn't render. */
  calendarLinks?: CalendarLinks;
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
  /**
   * How many OTHER partner contacts got their own copy. Recipients can't see
   * each other (one send per address), so the template says so explicitly.
   * Optional: 0 or absent renders nothing.
   */
  otherRecipientCount?: number;
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

// Referral program lifecycle (both transactional — no unsubscribeUrl).

export interface ReferralRedeemedProps {
  firstName: string;
  /** The referrer as the friend knows them: "Wes" or "BFT Carytown". */
  referrerName: string;
  discountPercent: number;
  bookUrl: string;
}

export interface ReferralRewardEarnedProps {
  firstName: string;
  friendFirstName: string;
  bookUrl: string;
}

// Staff scheduling sub requests (all transactional — no unsubscribeUrl).

export interface SubRequestNoticeProps {
  staffName: string;
  shiftLabel: string;
  /** e.g. "Thursday, August 14" */
  dateLabel: string;
  /** e.g. "2:30p–8:30p" */
  timeLabel: string;
  /** How many available people were emailed a claim link. */
  notifiedCount: number;
  scheduleUrl: string;
}

export interface SubOpenNoticeProps {
  /** The recipient — the person who could take the shift. */
  firstName: string;
  requesterName: string;
  shiftLabel: string;
  dateLabel: string;
  timeLabel: string;
  /** Signed one-click claim link bound to this recipient. */
  claimUrl: string;
  scheduleUrl: string;
}

export interface SubClaimedNoticeProps {
  takerName: string;
  requesterName: string;
  shiftLabel: string;
  dateLabel: string;
  timeLabel: string;
  scheduleUrl: string;
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
  'referral-redeemed': ReferralRedeemedProps;
  'referral-reward-earned': ReferralRewardEarnedProps;
  'sub-request-notice': SubRequestNoticeProps;
  'sub-open-notice': SubOpenNoticeProps;
  'sub-claimed-notice': SubClaimedNoticeProps;
}

export type EmailTemplateKey = keyof EmailPropsByTemplate;
