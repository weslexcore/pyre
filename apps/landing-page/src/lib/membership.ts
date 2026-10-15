import type { MembershipContent } from './types';

// Founding-membership facts, in one place. Tier features, the site banner,
// /hi, partner pages and the Rest Fest page all build their wording from
// these, so a price or cap change is one edit here.

/** How many of each founding tier exist. */
export const FOUNDING_CAP = 30;

const UNLIMITED = {
  price: 199,
  originalPrice: 249,
  href: 'https://momence.com/m/943595',
};

const LIMITED = {
  price: 119,
  monthlyCredits: 8,
  href: 'https://momence.com/m/633377',
};

const membership: MembershipContent = {
  title: 'Memberships',
  // subtitle: 'Founding Member offer: $199/mo for life (normally $249). Only 30 available.',
  note: 'Founding rates are locked in for life. Memberships are not shareable.',
  tiers: [
    {
      id: 'unlimited',
      name: 'Founding Unlimited',
      price: UNLIMITED.price,
      originalPrice: UNLIMITED.originalPrice,
      period: '/month for life',
      description:
        'Unlimited access, locked at the founding rate for life. The deepest way to make Pyre part of your routine.',
      savings: 200,
      popular: true,
      features: [
        {
          text: "Unlimited access - use 12 credits + 4 guest passes and you'll save over $200",
          highlighted: true,
        },
        { text: 'Free bathhouse tote' },
        { text: '4 guest passes per month ($100+ value)' },
        { text: '10% off drinks + merch' },
        { text: `Only ${FOUNDING_CAP} available`, highlighted: true },
      ],
      cta: {
        label: 'Claim Founding Membership',
        href: UNLIMITED.href,
        ariaLabel: `Claim Founding Unlimited membership — $${UNLIMITED.price} per month for life`,
      },
    },
    {
      id: 'founding-limited',
      name: 'Founding Limited',
      price: LIMITED.price,
      period: '/month',
      description: `${LIMITED.monthlyCredits} credits every month at the founding rate for life. A steady rhythm without the unlimited commitment.`,
      savings: 81,
      features: [
        { text: `${LIMITED.monthlyCredits} credits per month`, highlighted: true },
        { text: '1 guest pass per month' },
        { text: '10% off drinks + merch' },
        { text: `Only ${FOUNDING_CAP} available`, highlighted: true },
      ],
      cta: {
        label: 'Claim Founding Membership',
        href: LIMITED.href,
        ariaLabel: `Claim Founding Limited membership — $${LIMITED.price} per month`,
      },
    },
  ],
};

/** Wording shared by every page that pitches founding memberships. */
export const founding = {
  cap: FOUNDING_CAP,
  unlimited: UNLIMITED,
  limited: LIMITED,
  /** Lowest monthly price across tiers: "From $119/mo". */
  fromPrice: Math.min(...membership.tiers.map((tier) => tier.price)),
  eyebrow: 'Founding Memberships',
  /** One-line pitch for both tiers, used on partner pages. */
  pitch: `Founding rates are locked in for life, and only ${FOUNDING_CAP} of each exist. Go unlimited or keep a steady rhythm of ${LIMITED.monthlyCredits} credits a month.`,
  /** Announcement for the unlimited tier, used by the site banner. */
  announcement: `Founding Memberships are here — $${UNLIMITED.price}/mo for life (normally $${UNLIMITED.originalPrice}). Only ${FOUNDING_CAP} available.`,
};

export default membership;
