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
    /**
     * After a successful signup, send the visitor here (same tab) so they can
     * buy the offer right away. A fallback link with `redirect.label` is shown
     * in case the redirect doesn't happen.
     */
    redirect?: {
      href: string;
      label: string;
      /** Delay before redirecting, in ms. Defaults to 1200. */
      delayMs?: number;
    };
  };
  /** Short text shown on the floating tab when popup is dismissed (e.g. "Join the List"). */
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
    id: 'mailing-list-2026-11',
    enabled: true,
    headline: 'Stay in the Loop',
    body: 'Join our mailing list for the latest on upcoming events, news, and discounts.',
    promoText: 'Join the List',
    form: {
      submitLabel: 'Join the Mailing List',
      successMessage: "You're on the list! Watch your inbox for what's next.",
    },
    dismiss: {
      label: 'No thanks',
    },
    delayMs: 1500,
  },
];

export default promoPopups;
