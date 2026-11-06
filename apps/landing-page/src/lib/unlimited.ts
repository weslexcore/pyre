// Copy for the /unlimited landing page: sells the Founding Unlimited
// membership benefits first, and shows the price only in the checkout step at
// the bottom of the page (`join`). Anyone not ready to commit is sent to the
// /intro landing page. Prices, links and the deadline come from membership.ts
// and sessions.ts so they stay in sync with the rest of the site.
import membership, { founding } from './membership';
import { introOffer, SINGLE_CREDIT_PRICE } from './sessions';

const { price, originalPrice } = founding.unlimited;

const GUEST_PASSES = 4;
const INTRO_WEEKS = introOffer.days / 7;

export interface UnlimitedBenefit {
  title: string;
  body: string;
}

const unlimited = {
  meta: {
    title: 'Founding Unlimited Membership | Unlimited Sauna + Cold Plunge | Pyre Sauna',
    description: `Unlimited sauna + cold plunge in Richmond, VA, with your founding rate locked in for life. Only available through ${founding.deadline}. New here? Start with ${introOffer.pitch}.`,
  },

  hero: {
    eyebrow: founding.eyebrow,
    title: 'Unlimited sauna + cold plunge',
    subtitle:
      'Make heat, cold and community part of your week. Join as a founding member and your monthly rate is locked in for life.',
    pill: founding.availability,
    primaryCta: {
      label: 'Become a Founding Member',
      href: '#join',
      ariaLabel: 'Jump to the founding membership checkout',
    },
    secondaryCta: {
      label: `New here? Try ${INTRO_WEEKS} weeks unlimited`,
      href: introOffer.landing.href,
      ariaLabel: 'See the intro offer',
    },
  },

  /** Short proof points under the hero. */
  stats: [
    { value: `${GUEST_PASSES}`, label: 'guest passes every month' },
    { value: '15%', label: 'off merch, drinks + rentals' },
    { value: founding.deadline, label: 'last day to lock in the founding rate' },
  ],

  included: {
    heading: "What's included",
    subtitle: 'Everything you need to make Pyre a habit — and bring your people with you.',
    benefits: [
      {
        title: 'Unlimited sessions',
        body: 'Unlimited monthly credits for sauna + cold plunge. Come daily, come twice a day — book whenever there is room.',
      },
      {
        title: `${GUEST_PASSES} guest passes / month`,
        body: `Bring a friend, partner or coworker on us, four times a month. That's up to $${GUEST_PASSES * SINGLE_CREDIT_PRICE} of sessions to share.`,
      },
      {
        title: '15% off the extras',
        body: 'Members save 15% on merch, drinks and private rentals.',
      },
      {
        title: 'Members-only community',
        body: 'Access to members-only events, members-only merch and the members WhatsApp group.',
      },
      {
        title: 'Pause when life happens',
        body: 'Traveling or need a break? Pause up to 3 months in any 12-month period.',
      },
      {
        title: 'Founding rate for life',
        body: `Your monthly rate never goes up, as long as you stay a member. Standard Unlimited will cost more after ${founding.deadline}; founding members never pay it.`,
      },
    ] satisfies UnlimitedBenefit[],
  },

  founding: {
    heading: 'Why founding?',
    body: `Founding members are the people who help us build Pyre from day one. As a thank-you, your monthly rate is locked in for as long as you're a member, below what standard Unlimited will cost. The founding rate is only available through ${founding.deadline}, and it won't come back.`,
    points: [
      'Your rate is locked in for life',
      'Never pay the standard Unlimited rate',
      'Pausing never changes your rate',
      `Only available through ${founding.deadline}`,
    ],
  },

  /**
   * Short "not ready to commit?" band that hands off to the /intro landing
   * page, which does the selling. `steps` are not rendered here any more;
   * the homepage offer section (offer.ts) still shares them.
   */
  intro: {
    eyebrow: 'Not ready to commit?',
    heading: `Start with ${INTRO_WEEKS} weeks unlimited`,
    body: `${introOffer.pitch.charAt(0).toUpperCase()}${introOffer.pitch.slice(1)}, with everything members get. Try the full experience before you decide — and if you join during your intro, we'll take $${introOffer.membershipDiscount} off your first month.`,
    steps: [
      {
        title: 'Grab the intro',
        body: `${introOffer.days} days of unlimited sauna + cold plunge, plus a guest pass.`,
      },
      {
        title: 'Build the habit',
        body: 'Come as often as you like and bring a friend with your guest pass.',
      },
      {
        title: 'Join as a founding member',
        body: `Upgrade before your intro ends and save $${introOffer.membershipDiscount} on month one. Founding rate through ${founding.deadline}.`,
      },
    ],
    cta: {
      label: introOffer.landing.label,
      href: introOffer.landing.href,
      ariaLabel: `See the intro offer: ${introOffer.pitch}`,
    },
  },

  testimonials: {
    heading: 'From our community',
  },

  faqs: {
    heading: 'Membership questions',
    items: [
      {
        question: "What do you mean by 'for life'?",
        answer: `Your founding rate never goes up for as long as you keep your membership. Standard Unlimited costs more, and even if that price rises over the years, yours stays where it started. Pausing your membership doesn't affect your rate. If you cancel, the founding rate ends, and rejoining later would be at the standard rate.`,
      },
      {
        question: 'What counts as unlimited?',
        answer:
          'Unlimited monthly credits for sauna + cold plunge sessions. Book any session with open spots, as often as you like.',
      },
      {
        question: 'How do guest passes work?',
        answer: `You get ${GUEST_PASSES} guest passes every month. Add a friend when you book your session and they come with you on us.`,
      },
      {
        question: 'Can I pause my membership?',
        answer: 'Yes. You can pause for up to 3 months in any 12-month period.',
      },
      {
        question: 'Can I share my membership?',
        answer:
          'Memberships are for one person and are not shareable — but your guest passes are made for bringing people along.',
      },
      {
        question: "I've never been. Where should I start?",
        answer: `Start with the intro: ${introOffer.pitch}. Join as a member during your intro and take $${introOffer.membershipDiscount} off your first month.`,
      },
      {
        question: 'When does the founding rate end?',
        answer: `The founding rate is only available through ${founding.deadline}. After that, Unlimited is sold at the standard rate.`,
      },
    ],
  },

  /** Checkout step: the only place on the page that shows the price. */
  join: {
    eyebrow: 'Ready to join?',
    heading: 'Lock in your founding rate',
    body: `${founding.availability}. Checkout takes about a minute, and your first session can be today.`,
    price,
    originalPrice,
    period: '/mo for life',
    savings: `Save $${(originalPrice - price) * 12} a year vs. standard Unlimited`,
    recap: [
      'Unlimited sauna + cold plunge',
      `${GUEST_PASSES} guest passes every month`,
      'Rate locked in for life',
    ],
    cta: founding.checkout,
    finePrint: membership.note,
    intro: {
      label: `Not ready? Start with ${INTRO_WEEKS} weeks unlimited`,
      href: introOffer.landing.href,
      ariaLabel: 'See the intro offer',
    },
  },
};

export default unlimited;
