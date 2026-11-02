import type { ActionRef } from './types';

/** A monthly subscription to the same number of credits as a pack, shown beside it. */
export interface SessionSubscription {
  name: string;
  price: number;
  originalPrice?: number;
  savings?: number;
  /** Billing period shown after the price: "/mo". */
  period: string;
  caption: string;
  href: string;
}

export interface SessionItem {
  id: string;
  name: string;
  price: number;
  originalPrice?: number;
  description: string;
  savings?: number;
  highlighted?: boolean;
  /** Fine print for the one-time option when a subscription is shown beside it. */
  caption?: string;
  /** When set, the row compares the one-time pack with this subscription. */
  subscription?: SessionSubscription;
  href?: string;
}

export interface SessionsContent {
  title: string;
  subtitle?: string;
  note?: string;
  items: SessionItem[];
  cta?: ActionRef;
}

/** Drop-in price of one credit; pack and subscription savings are measured against it. */
export const SINGLE_CREDIT_PRICE = 25;

/**
 * The intro offer, in one place. The credits section, partner pages, /hi and
 * the promo popup all build their wording from this object, so changing the
 * offer is one edit here.
 */
export const introOffer = {
  price: 50,
  /** Length of the unlimited intro period, in days. */
  days: 14,
  /** Dollars off the first month of membership when bought during the intro period. */
  membershipDiscount: 50,
  /** Headline form: "Intro // 2 Weeks Unlimited". */
  headline: '2 Weeks Unlimited',
  /** Shortest form, for tight spots like the promo tab. */
  shortLabel: '2 Weeks Unlimited',
  /** Sentence form, written to open a sentence: "Get 2 weeks of unlimited sauna + cold plunge for $50." */
  sentence: 'Get 2 weeks of unlimited sauna + cold plunge for $50',
  perks: ['Unlimited credits', '1 guest pass', '15% off drinks, merch + private events'],
  href: 'https://momence.com/m/966626',
};

/** Price caption: "for 2 weeks unlimited". */
export const introPriceNote = 'for 2 weeks unlimited';

/** Membership upsell line for the intro: "Join during your intro and take $50 off your first month." */
export const introMembershipPerk = `Join the Founding Unlimited membership during your intro and take $${introOffer.membershipDiscount} off your first month.`;

/** A price plus its struck-through value and savings vs. buying single credits. */
const creditPricing = (credits: number, price: number) => ({
  price,
  originalPrice: credits * SINGLE_CREDIT_PRICE,
  savings: credits * SINGLE_CREDIT_PRICE - price,
});

const PACK_CAPTION = 'Expires 3 months after purchase';
const SUBSCRIPTION_CAPTION = 'Billed monthly, credits expire monthly';

const sessions: SessionsContent = {
  title: 'Credits',
  note: 'All credits can be shared with friends & family!',
  items: [
    {
      id: 'intro',
      name: `Intro // ${introOffer.headline}`,
      price: introOffer.price,
      description: `New here? Unlimited sauna + cold plunge for 2 weeks, plus 1 guest pass and 15% off drinks, merch + private events. Join the membership during your intro and get $${introOffer.membershipDiscount} off your first month. Available once per customer.`,
      highlighted: true,
      href: introOffer.href,
    },
    {
      id: 'single',
      name: '1 Credit',
      price: SINGLE_CREDIT_PRICE,
      description: 'Drop-in for an hour',
      href: '/events',
    },
    {
      id: 'pack-2',
      name: '2 Credits',
      ...creditPricing(2, 45),
      description:
        'Come for a special event, stay for 2 hours, or come back again. Expires 3 months after purchase.',
      href: 'https://momence.com/m/702636',
    },
    {
      id: 'pack-4',
      name: '4 Credits',
      ...creditPricing(4, 85),
      description: 'Build momentum - come back often or bring a friend.',
      caption: PACK_CAPTION,
      href: 'https://momence.com/m/630915',
      subscription: {
        name: 'Circle Subscription',
        ...creditPricing(4, 75),
        period: '/mo',
        caption: SUBSCRIPTION_CAPTION,
        href: 'https://momence.com/m/966625',
      },
    },
    {
      id: 'pack-8',
      name: '8 Credits',
      ...creditPricing(8, 165),
      description: 'Our best value - designed for consistency and shared experiences.',
      caption: PACK_CAPTION,
      href: 'https://momence.com/m/630916',
      subscription: {
        name: 'Ritual Subscription',
        ...creditPricing(8, 140),
        period: '/mo',
        caption: SUBSCRIPTION_CAPTION,
        href: 'https://momence.com/m/966622',
      },
    },
  ],
};

export default sessions;
