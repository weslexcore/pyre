export interface PromoPopupConfig {
  /** Unique ID used as the localStorage key. Change this to re-show the popup. */
  id: string;
  /** Whether the popup is currently active. Set to false to disable without removing code. */
  enabled: boolean;
  /** Main heading displayed in the popup. */
  headline: string;
  /** Supporting body text. */
  body: string;
  /** Primary call-to-action button. */
  cta: {
    label: string;
    href: string;
  };
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
  id: 'founding-membership-launch',
  enabled: true,
  headline: 'Founding Memberships Are Here',
  body: '20% off unlimited membership for life with code SECRETGARDEN. Offer expires April 23rd.',
  cta: {
    label: 'Become a Member',
    href: 'https://momence.com/m/630919',
  },
  dismiss: {
    label: 'No thanks',
  },
  expires: '2026-04-23T00:00:00-04:00',
  delayMs: 1500,
};

export default promoPopup;
