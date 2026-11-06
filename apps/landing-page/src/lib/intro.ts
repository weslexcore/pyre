// Copy for the /intro landing page: spells out what the intro offer includes
// and how a first visit works, and shows the price only in the checkout step
// at the bottom of the page (`claim`). The offer itself (length, perks,
// checkout link) lives in sessions.ts; the membership upsell comes from
// membership.ts so the two pages never drift apart.
import { founding } from './membership';
import { withBase } from './paths';
import { introMembershipPerk, introOffer, introPriceNote } from './sessions';

const WEEKS = introOffer.days / 7;

export interface IntroBenefit {
  title: string;
  body: string;
}

const intro = {
  meta: {
    title: `Intro Offer | ${WEEKS} Weeks Unlimited Sauna + Cold Plunge | Pyre Sauna`,
    description: `New to Pyre? Start with ${introOffer.pitch} in Richmond, VA, plus a guest pass and 15% off drinks + merch. Available once per customer.`,
  },

  hero: {
    eyebrow: 'New here? Start here',
    title: `${WEEKS} weeks unlimited`,
    subtitle:
      'Two full weeks of unlimited sauna + cold plunge. Come as often as you like, bring a friend, and find out what heat, cold and community can do for your week.',
    pill: 'Available once per customer',
    primaryCta: {
      label: 'Claim the Intro',
      href: '#claim',
      ariaLabel: 'Jump to the intro offer checkout',
    },
    secondaryCta: {
      label: 'Just want one session?',
      href: withBase('/events'),
      ariaLabel: 'Browse and book a single session',
    },
  },

  /** Short proof points under the hero. */
  stats: [
    { value: `${introOffer.days}`, label: 'days of unlimited sessions' },
    { value: '1', label: 'guest pass to bring a friend' },
    { value: '15%', label: 'off drinks + merch' },
  ],

  included: {
    heading: 'What you get',
    subtitle: 'The full member experience for two weeks, with no commitment.',
    benefits: [
      {
        title: 'Unlimited sessions',
        body: `Unlimited credits for sauna + cold plunge for ${introOffer.days} days. Book any session with open spots, as often as you like.`,
      },
      {
        title: '1 guest pass',
        body: 'Bring a friend, partner or coworker along for a session on us.',
      },
      {
        title: '15% off drinks + merch',
        body: 'Member pricing at the counter and on merch for the length of your intro.',
      },
      {
        title: 'Guided + open sessions',
        body: 'Join guided sessions led by certified sauna masters, or drop into open hours and go at your own pace.',
      },
      {
        title: 'Beginners welcome',
        body: 'No experience needed. Staff walk you through your first visit, from how long to sit to when to plunge.',
      },
      {
        title: `$${introOffer.membershipDiscount} off your first month`,
        body: `Join the Founding Unlimited membership before your intro ends and take $${introOffer.membershipDiscount} off your first month. Founding rate through ${founding.deadline}.`,
      },
    ] satisfies IntroBenefit[],
  },

  how: {
    heading: 'How it works',
    steps: [
      {
        title: 'Claim the intro',
        body: 'Check out online in about a minute, then book your first session from the schedule.',
      },
      {
        title: 'Show up',
        body: 'Pick any session with open spots. Bring a swimsuit and a water bottle; we provide towels and everything else.',
      },
      {
        title: 'Make it a habit',
        body: `Come as often as you like for ${introOffer.days} days, and bring a friend with your guest pass.`,
      },
      {
        title: 'Decide later',
        body: `Love it? Join as a founding member before your intro ends and save $${introOffer.membershipDiscount} on month one. Prefer to come less often? Credit packs work too.`,
      },
    ],
  },

  testimonials: {
    heading: 'From our community',
  },

  faqs: {
    heading: 'Intro questions',
    items: [
      {
        question: "I've never done a sauna or cold plunge. Is this for me?",
        answer:
          'Absolutely. No experience needed. Our certified sauna masters lead guided sessions with full instruction, and staff are always around to help you through your first visit.',
      },
      {
        question: 'What should I bring?',
        answer:
          'Bring a swimsuit, a water bottle and an optional robe / sandals. We provide towels and all the amenities you need for your session.',
      },
      {
        question: 'Do I need to book in advance?',
        answer:
          'We recommend booking in advance to guarantee your preferred time slot. Walk-ins are welcome based on availability, but booking ensures you get your desired session time.',
      },
      {
        question: 'How does the guest pass work?',
        answer:
          'Add a friend when you book a session and they come with you on us. The intro includes one guest pass.',
      },
      {
        question: 'How long should I stay in the sauna and cold plunge?',
        answer:
          'We recommend 10-20 minute sauna sessions followed by 1-3 minute cold plunge immersions. Repeat 2-4 rounds for optimal benefits. Our staff can guide you through your first session.',
      },
      {
        question: 'What happens after my intro?',
        answer: `${introMembershipPerk} Prefer to come less often? Credit packs are available too, and every credit can be shared with friends and family.`,
      },
      {
        question: 'Can I buy the intro more than once?',
        answer:
          'The intro is available once per customer. After that, a membership or a credit pack is the way to keep coming.',
      },
    ],
  },

  /** Checkout step: the only place on the page that shows the price. */
  claim: {
    eyebrow: 'Ready to start?',
    heading: `Claim your ${WEEKS} weeks`,
    body: 'Checkout takes about a minute, and your first session can be today.',
    price: introOffer.price,
    priceNote: introPriceNote,
    perks: [
      ...introOffer.perks,
      `$${introOffer.membershipDiscount} off your first month of membership`,
    ],
    cta: {
      label: 'Claim Intro Offer',
      href: introOffer.href,
      ariaLabel: `Buy the intro offer: ${introOffer.sentence.toLowerCase()}`,
    },
    finePrint: 'Available once per customer.',
    membership: {
      label: 'Ready to commit? See the Founding Unlimited membership',
      href: founding.details.href,
      ariaLabel: 'Explore the Founding Unlimited membership',
    },
  },
};

export default intro;
