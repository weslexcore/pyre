import { introOffer } from './sessions';
import type { MembershipContent } from './types';

// Founding-membership facts, in one place. Tier features, the site banner,
// /hi, partner pages and the Rest Fest page all build their wording from
// these, so a price or deadline change is one edit here.

/** Last day the founding membership can be bought, for display. */
export const FOUNDING_DEADLINE = 'Dec 31';

/** End of the founding offer (exclusive), for anything that auto-expires. */
export const FOUNDING_ENDS_AT = '2027-01-01T00:00:00-05:00';

const UNLIMITED = {
  price: 199,
  originalPrice: 249,
  href: 'https://momence.com/m/943595',
};

const membership: MembershipContent = {
  title: 'Membership',
  subtitle: `Interested in becoming a member? Join a community of people who are putting their health and connection first`,
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
      popular: true,
      features: [
        { text: 'Unlimited monthly credits', highlighted: true },
        { text: '4 guest passes per month' },
        { text: '15% off merch + drinks + private rentals' },
        { text: 'Access to members-only events + merch + members-only WhatsApp group' },
        { text: 'Pause up to 3 months in any 12-month period' },
        { text: `Only available through ${FOUNDING_DEADLINE}`, highlighted: true },
      ],
      cta: {
        label: 'Claim Founding Membership',
        href: UNLIMITED.href,
        ariaLabel: `Claim Founding Unlimited membership — $${UNLIMITED.price} per month for life`,
      },
    },
  ],
};

/** Wording shared by every page that pitches the founding membership. */
export const founding = {
  deadline: FOUNDING_DEADLINE,
  endsAt: FOUNDING_ENDS_AT,
  unlimited: UNLIMITED,
  /** Monthly price: "$199/mo". */
  fromPrice: UNLIMITED.price,
  eyebrow: 'Founding Membership',
  /** Availability line: "Only available through Dec 31". */
  availability: `Only available through ${FOUNDING_DEADLINE}`,
  /** One-line pitch, used on partner pages. */
  pitch: `Unlimited access at $${UNLIMITED.price}/mo, locked in for life. The founding rate is only available through ${FOUNDING_DEADLINE}.`,
  /** Announcement used by the site banner. */
  announcement: `Founding Unlimited Membership — $${UNLIMITED.price}/mo for life (normally $${UNLIMITED.originalPrice}). Only available through ${FOUNDING_DEADLINE}.`,
};

export default membership;
