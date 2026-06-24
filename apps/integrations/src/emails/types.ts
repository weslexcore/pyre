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

export interface EmailPropsByTemplate {
  confirmation: ConfirmationEmailProps;
  'first-timer-welcome': FirstTimerEmailProps;
}

export type EmailTemplateKey = keyof EmailPropsByTemplate;
