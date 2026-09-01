import { withBase } from './paths';

export interface PromoPopupConfig {
  /** Unique ID used as the localStorage key. Change this to re-show the popup. */
  id: string;
  /** Whether the popup is currently active. Set to false to disable without removing code. */
  enabled: boolean;
  /** Main heading displayed in the popup. */
  headline: string;
  /** Supporting body text. */
  body: string;
  /** Optional small-print line shown under the body (e.g. terms, end date). */
  finePrint?: string;
  /** Optional discount code rendered in a copyable block. */
  code?: {
    value: string;
    /** Label shown above the code. Defaults to "Use code". */
    label?: string;
  };
  /** Primary call-to-action button (link mode). */
  cta?: {
    label: string;
    href: string;
    ariaLabel?: string;
  };
  /** Inline email signup form (form mode). */
  form?: {
    submitLabel: string;
    successMessage: string;
  };
  /** Short text shown on the floating tab when popup is dismissed (e.g. "Buy 1, Get 1"). */
  promoText?: string;
  /** Optional dismiss link text. */
  dismiss?: {
    label: string;
  };
  /** ISO date string. Popup won't show before this date (checked on the visitor's clock). */
  starts?: string;
  /** ISO date string. Popup won't show after this date (checked on the visitor's clock). */
  expires?: string;
  /** Delay in ms after page load before showing the popup. Defaults to 1500. */
  delayMs?: number;
}

/**
 * Popups in priority order. The first enabled entry whose `starts`/`expires`
 * window is live (evaluated client-side) is shown; the rest are discarded.
 * Time-boxed promos go first so they take over from the evergreen popup and
 * hand back to it automatically when they end.
 */
const promoPopups: PromoPopupConfig[] = [
  {
    // Labor Day 2026 — Fri Sept 4 at noon through end of Mon Sept 7 (Eastern).
    id: 'labor-day-2026',
    enabled: true,
    headline: 'Labor Day Sale: 25% Off',
    body: 'Take 25% off credits, credit packs, and your first month of membership. Enter the code at checkout.',
    finePrint: 'Offer ends Monday, September 7.',
    code: {
      value: 'WORKIT25',
      label: 'Use code',
    },
    promoText: '25% Off',
    cta: {
      label: 'Shop the Sale',
      href: withBase('/#sessions'),
      ariaLabel: 'Shop credits, credit packs, and memberships',
    },
    dismiss: {
      label: 'Maybe later',
    },
    starts: '2026-09-04T12:00:00-04:00',
    expires: '2026-09-07T23:59:59-04:00',
    delayMs: 1500,
  },
  {
    id: 'intro-offer-email',
    enabled: true,
    headline: 'New Here? Buy 1, Get 1 Free',
    body: 'Sign up for our mailing list to receive an exclusive intro offer. Available once per customer. Credits cannot be shared.',
    promoText: 'Buy 1, Get 1',
    form: {
      submitLabel: 'Get Intro Offer',
      successMessage: "You're in! Check your email for details.",
    },
    dismiss: {
      label: 'No thanks',
    },
    delayMs: 1500,
  },
];

export default promoPopups;
