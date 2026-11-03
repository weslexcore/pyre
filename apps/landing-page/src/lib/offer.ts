// Copy for the homepage offer section: how a first visit leads to membership,
// plus the intro and founding offers side by side. Steps, perks and prices are
// shared with the /unlimited page (unlimited.ts) so the two never drift apart.
import { founding } from './membership';
import { introMembershipPerk, introOffer, introPriceNote } from './sessions';
import unlimited from './unlimited';

const { price, originalPrice, href } = founding.unlimited;

const offer = {
  eyebrow: 'New here? Start here',
  heading: 'From first visit to founding member',
  steps: unlimited.intro.steps,

  intro: {
    label: 'Intro',
    name: introOffer.headline,
    price: introOffer.price,
    priceNote: introPriceNote,
    perks: introOffer.perks,
    perk: introMembershipPerk,
    finePrint: 'Available once per customer.',
    cta: {
      label: 'Claim Intro Offer',
      href: introOffer.href,
      ariaLabel: `Buy the intro offer: ${introOffer.sentence.toLowerCase()}`,
    },
  },

  founding: {
    label: founding.eyebrow,
    name: 'Founding Unlimited',
    price,
    originalPrice,
    period: '/mo for life',
    savings: `Save $${originalPrice - price}/mo forever`,
    perks: [
      'Unlimited sauna + cold plunge',
      '4 guest passes every month',
      'Pause up to 3 months a year',
    ],
    cta: {
      label: 'Claim Founding Membership',
      href,
      ariaLabel: `Claim the Founding Unlimited membership: $${price} per month for life`,
    },
    details: founding.details,
  },
};

export default offer;
