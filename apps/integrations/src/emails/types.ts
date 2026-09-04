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
  /** e.g. "Sat, June 20, 2026" */
  dateLabel: string;
  /** e.g. "10:00 AM – 12:00 PM EDT"; empty when the session couldn't be resolved. */
  timeLabel: string;
  /**
   * When to show up, as a clock time (lib/email/arrival.ts). Absent when the
   * session couldn't be resolved — the line simply doesn't render.
   */
  arrivalLabel?: string;
  /** Momence's event location; normalised to the venue address by the template. */
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

/** One shift on the Monday roundup, from the recipient's point of view. */
export interface WeeklyShiftItem {
  /** e.g. "Mon, Aug 17" */
  dayLabel: string;
  /** The shift window name: Morning / Evening / Maintenance... */
  shiftLabel: string;
  /** The recipient's own hours, e.g. "2:30p–8:30p" */
  timeLabel: string;
  /** Deep link straight to this shift on the board. */
  shiftUrl: string;
  /** Set for 'setup'/'partial' assignments — omitted for a full window. */
  roleLabel?: string;
  /** The shift's notes, if any (e.g. "Private event — 20 guests"). */
  notes?: string;
  /** True while the recipient has an open sub request on this shift. */
  subRequested?: boolean;
}

export interface WeeklyShiftsProps {
  firstName: string;
  /** e.g. "Aug 17–23" */
  weekLabel: string;
  /** Chronological; never empty (people with no shifts aren't emailed). */
  shifts: WeeklyShiftItem[];
  /** Total scheduled hours for the week, e.g. "18.5". */
  totalHours: string;
  scheduleUrl: string;
}

export interface ShiftRequestDecisionProps {
  /** The requester — the employee whose ask was decided. */
  firstName: string;
  decision: 'approved' | 'denied';
  shiftLabel: string;
  dateLabel: string;
  /** The window the request covered — the shift's, or its setup span. */
  timeLabel: string;
  /** "Full" | "Setup" */
  roleLabel: string;
  /** Optional reason the manager attached to the decision. */
  reasonNote?: string | null;
  scheduleUrl: string;
}

// Sent to management when a serious incident is filed (severe/critical, or
// EMS/police involved). Everything here is already formatted for display —
// the template does no lookups of its own.
export interface IncidentReportedProps {
  /** Case number, e.g. "INC-2026-0042". */
  reference: string;
  severityLabel: string;
  categoryLabel: string;
  areaLabel: string;
  /** e.g. "Tuesday, August 21 at 7:42 PM" (bathhouse wall-clock time). */
  occurredLabel: string;
  /** Display name of whoever filed it, falling back to their email. */
  reportedByLabel: string;
  description: string;
  immediateActions: string;
  injuredCount: number;
  emsCalled: boolean;
  incidentUrl: string;
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
  'weekly-shifts': WeeklyShiftsProps;
  'shift-request-decision': ShiftRequestDecisionProps;
  'incident-reported': IncidentReportedProps;
}

export type EmailTemplateKey = keyof EmailPropsByTemplate;
