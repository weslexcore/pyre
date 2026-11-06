// Copy for the homepage offer section: how a first visit leads to membership,
// plus the intro and founding offers side by side. Neither card shows a price:
// each sends people to its landing page (/intro, /unlimited), which spells out
// the offer and shows the price at checkout. Steps and perks are shared with
// the /unlimited page (unlimited.ts) so the two never drift apart.
import { founding } from './membership';
import { introMembershipPerk, introOffer } from './sessions';
import unlimited from './unlimited';

const offer = {
  eyebrow: 'New here? Start here',
  heading: 'From first visit to founding member',
  steps: unlimited.intro.steps,

  intro: {
    label: 'Intro',
    name: introOffer.headline,
    tagline: 'The full member experience, with no commitment.',
    perks: introOffer.perks,
    perk: introMembershipPerk,
    finePrint: 'Available once per customer.',
    cta: {
      label: introOffer.landing.label,
      href: introOffer.landing.href,
      ariaLabel: `See the intro offer: ${introOffer.pitch}`,
    },
  },

  founding: {
    label: founding.eyebrow,
    name: 'Founding Unlimited',
    tagline: 'Your monthly rate, locked in for life.',
    perks: [
      'Unlimited sauna + cold plunge',
      '4 guest passes every month',
      'Pause up to 3 months a year',
    ],
    cta: {
      label: founding.landing.label,
      href: founding.landing.href,
      ariaLabel: 'Explore the Founding Unlimited membership and everything it includes',
    },
  },
};

export default offer;
