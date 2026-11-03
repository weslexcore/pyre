// Copy for the /unlimited landing page: sells the Founding Unlimited
// membership, and funnels anyone not ready to commit into the intro offer
// (which itself discounts the first month of membership). Prices, links and
// the deadline come from membership.ts / sessions.ts so they stay in sync with
// the rest of the site.
import { founding } from './membership';
import { introOffer, SINGLE_CREDIT_PRICE } from './sessions';

const { price, originalPrice, href } = founding.unlimited;

/** Average weeks in a month, for per-visit math. */
const WEEKS_PER_MONTH = 52 / 12;

const GUEST_PASSES = 4;

export interface UnlimitedBenefit {
  title: string;
  body: string;
}

export interface UnlimitedVisitRow {
  label: string;
  visitsPerMonth: number;
  perVisit: number;
  dropInTotal: number;
}

const visitRow = (perWeek: number): UnlimitedVisitRow => {
  const visitsPerMonth = Math.round(perWeek * WEEKS_PER_MONTH);
  return {
    label: `${perWeek}x a week`,
    visitsPerMonth,
    perVisit: Math.round(price / visitsPerMonth),
    dropInTotal: visitsPerMonth * SINGLE_CREDIT_PRICE,
  };
};

/** Visits per month at which unlimited costs less than drop-ins. */
const breakEvenVisits = Math.ceil(price / SINGLE_CREDIT_PRICE);

const unlimited = {
  meta: {
    title: `Founding Unlimited Membership | $${price}/mo for Life | Pyre Sauna`,
    description: `Unlimited sauna + cold plunge in Richmond, VA. Lock in the founding rate of $${price}/mo for life (normally $${originalPrice}) — only through ${founding.deadline}. New here? ${introOffer.sentence}.`,
  },

  hero: {
    eyebrow: founding.eyebrow,
    title: 'Unlimited sauna + cold plunge',
    subtitle: `Make heat, cold and community part of your week. Lock in $${price}/mo for life — normally $${originalPrice}.`,
    pill: founding.availability,
    primaryCta: {
      label: 'Claim Founding Membership',
      href,
      ariaLabel: `Claim the Founding Unlimited membership — $${price} per month for life`,
    },
    secondaryCta: {
      label: `New here? Try ${introOffer.days / 7} weeks for $${introOffer.price}`,
      href: '#intro',
      ariaLabel: 'See the intro offer',
    },
  },

  /** Short proof points under the hero. */
  stats: [
    { value: `$${price}`, label: 'per month, for life' },
    { value: `$${(originalPrice - price) * 12}`, label: 'saved every year vs. standard' },
    { value: `${GUEST_PASSES}`, label: 'guest passes every month' },
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
        body: `Your $${price}/mo never goes up, as long as you stay a member. Standard Unlimited will be $${originalPrice}/mo.`,
      },
    ] satisfies UnlimitedBenefit[],
  },

  math: {
    heading: 'The math',
    subtitle: `A drop-in session is $${SINGLE_CREDIT_PRICE}. Unlimited pays for itself at ${breakEvenVisits} visits a month — about twice a week.`,
    rows: [visitRow(2), visitRow(3), visitRow(4)],
    footnote: `Per-visit cost assumes ${WEEKS_PER_MONTH.toFixed(1)} weeks per month, before counting guest passes or member discounts.`,
  },

  founding: {
    heading: 'Why founding?',
    body: `Founding members are the people who help us build Pyre from day one. As a thank-you, your rate is locked at $${price}/mo for as long as you're a member — $${originalPrice - price} less every month than standard Unlimited. The founding rate is only available through ${founding.deadline}, and it won't come back.`,
    compare: [
      { label: 'Founding Unlimited', price, note: 'Locked for life', highlighted: true },
      {
        label: 'Standard Unlimited',
        price: originalPrice,
        note: `After ${founding.deadline}`,
        highlighted: false,
      },
    ],
  },

  intro: {
    eyebrow: 'Not ready to commit?',
    heading: `Start with ${introOffer.days / 7} weeks unlimited`,
    body: `${introOffer.sentence}. Try the full member experience before you decide — and if you join during your intro, we'll take $${introOffer.membershipDiscount} off your first month.`,
    price: introOffer.price,
    priceNote: `for ${introOffer.days} days unlimited`,
    perks: [
      ...introOffer.perks,
      `$${introOffer.membershipDiscount} off your first month of membership`,
    ],
    finePrint: 'Available once per customer.',
    steps: [
      {
        title: `Grab the intro`,
        body: `$${introOffer.price} for ${introOffer.days} days of unlimited sauna + cold plunge.`,
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
      label: 'Claim Intro Offer',
      href: introOffer.href,
      ariaLabel: `Claim the intro offer — ${introOffer.sentence.toLowerCase()}`,
    },
  },

  testimonials: {
    heading: 'From our community',
  },

  faqs: {
    heading: 'Membership questions',
    items: [
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
        question: 'Will my price ever go up?',
        answer: `No. Founding members keep $${price}/mo for life, as long as the membership stays active. Standard Unlimited will be $${originalPrice}/mo.`,
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
        answer: `Start with the intro: ${introOffer.sentence.charAt(0).toLowerCase()}${introOffer.sentence.slice(1)}. Join as a member during your intro and take $${introOffer.membershipDiscount} off your first month.`,
      },
      {
        question: 'When does the founding rate end?',
        answer: `The founding rate is only available through ${founding.deadline}. After that, Unlimited is $${originalPrice}/mo.`,
      },
    ],
  },

  closing: {
    heading: `Lock in $${price}/mo for life`,
    body: `${founding.availability}. Join now, or start with the intro and decide in ${introOffer.days / 7} weeks.`,
  },
};

export default unlimited;
