import type { ActionRef } from './types';

export interface SessionItem {
  id: string;
  name: string;
  price: number;
  originalPrice?: number;
  description: string;
  savings?: number;
  highlighted?: boolean;
  href?: string;
}

export interface SessionsContent {
  title: string;
  subtitle?: string;
  note?: string;
  items: SessionItem[];
  cta?: ActionRef;
}

/** Drop-in price of one credit; the intro offer's value is measured against it. */
export const SINGLE_CREDIT_PRICE = 25;

/**
 * The intro offer, in one place. The credits section, partner pages, /hi and
 * the promo popup all build their wording from this object, so changing the
 * offer is one edit here.
 */
export const introOffer = {
  /** Credits the customer receives. */
  credits: 2,
  price: 25,
  /** Headline form: "Intro // Buy 1, Get 1 Free". */
  headline: 'Buy 1, Get 1 Free',
  /** Shortest form, for tight spots like the promo tab. */
  shortLabel: 'Buy 1, Get 1',
  /** Sentence form, written to open a sentence: "Buy 1 credit, get 1 free." */
  sentence: 'Buy 1 credit, get 1 free',
  href: 'https://momence.com/m/630918',
};

/** What the intro credits would cost at the single-credit price. */
export const introValue = introOffer.credits * SINGLE_CREDIT_PRICE;

/** Price caption: "for 2 credits". */
export const introPriceNote = `for ${introOffer.credits} credits`;

/** A pack's price plus its struck-through value and savings vs. buying singles. */
const packPricing = (credits: number, price: number) => ({
  price,
  originalPrice: credits * SINGLE_CREDIT_PRICE,
  savings: credits * SINGLE_CREDIT_PRICE - price,
});

const sessions: SessionsContent = {
  title: 'Credits',
  note: 'All credits can be shared with friends & family!',
  items: [
    {
      id: 'intro',
      name: `Intro // ${introOffer.headline}`,
      price: introOffer.price,
      originalPrice: introValue,
      description: `New here? Start with ${introOffer.credits} credits and see how it feels. Available once per customer.`,
      savings: introValue - introOffer.price,
      highlighted: true,
      href: introOffer.href,
    },
    {
      id: 'single',
      name: 'Single // 1 Credit',
      price: SINGLE_CREDIT_PRICE,
      description: 'Drop-in for an hour',
      href: '/events',
    },
    {
      id: 'pack-2',
      name: 'Duo // 2 Credits',
      ...packPricing(2, 45),
      description: 'Come for a special event, stay for 2 hours, or come back again.',
      href: 'https://momence.com/m/702636',
    },
    {
      id: 'pack-4',
      name: 'Circle // 4 Credits',
      ...packPricing(4, 85),
      description: 'Build momentum - come back often or bring your circle.',
      href: 'https://momence.com/m/630915',
    },
    {
      id: 'pack-8',
      name: 'Ritual // 8 Credits',
      ...packPricing(8, 165),
      highlighted: true,
      description: 'Our best value - designed for consistency, connection, and shared experiences.',
      href: 'https://momence.com/m/630916',
    },
  ],
};

export default sessions;
