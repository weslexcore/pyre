export interface PromoPopupConfig {
  /** Unique ID used as the localStorage key. Change this to re-show the popup. */
  id: string;
  /** Whether the popup is currently active. Set to false to disable without removing code. */
  enabled: boolean;
  /** Main heading displayed in the popup. */
  headline: string;
  /** Supporting body text. */
  body: string;
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
  /** ISO date string. Popup won't show before this date. */
  starts?: string;
  /** ISO date string. Popup won't show after this date. */
  expires?: string;
  /** Delay in ms after page load before showing the popup. Defaults to 1500. */
  delayMs?: number;
}

// const promoPopup: PromoPopupConfig = {
//   id: 'founding-membership-launch',
//   enabled: false,
//   headline: 'Founding Memberships Are Here',
//   body: 'Sign up now to lock in exclusive founding member pricing before spots fill up.',
//   cta: {
//     label: 'Become a Member',
//     href: withBase('#membership'),
//   },
//   dismiss: {
//     label: 'Maybe later',
//   },
//   delayMs: 1500,
// };

const promoPopup: PromoPopupConfig = {
  id: 'intro-offer-email',
  enabled: true,
  headline: 'New Here? Buy 1, Get 1 Free',
  body: 'Sign up for our mailing list to receive an exclusive intro offer.',
  promoText: 'Buy 1, Get 1',
  form: {
    submitLabel: 'Get Intro Offer',
    successMessage: "You're in! Check your email for details.",
  },
  dismiss: {
    label: 'No thanks',
  },
  delayMs: 1500,
};

export default promoPopup;
