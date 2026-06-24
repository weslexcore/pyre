// Per-template prop interfaces and the template -> props map that keeps the
// registry, sendTemplate(), and call sites type-safe.

export interface ConfirmationEmailProps {
  firstName: string;
  sessionTitle: string;
  dateLabel: string;
  timeLabel: string;
  location: string;
  // manageUrl: string;
  /** The booked event's own image; templates fall back to a stock header without it. */
  sessionImageUrl?: string;
  /** FAQ items shown in the confirmation; selected by session type in the dispatcher. */
  faqs?: FaqItem[];
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
  'guided-confirmation': ConfirmationEmailProps;
  'social-confirmation': ConfirmationEmailProps;
  'special-event-confirmation': ConfirmationEmailProps;
  'general-confirmation': ConfirmationEmailProps;
  'first-timer-welcome': FirstTimerEmailProps;
}

export type EmailTemplateKey = keyof EmailPropsByTemplate;
