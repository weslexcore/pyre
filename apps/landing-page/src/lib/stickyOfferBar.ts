// Copy for the mobile sticky offer bar (components/StickyOfferBar.astro).
// Neither variant shows a price: both send people to a landing page (/intro,
// /unlimited) that spells out the offer and shows the price at checkout.
import { founding } from './membership';
import { introOffer } from './sessions';

const stickyOfferBar = {
  /** The founding variant is dropped after this time (visitor's clock). */
  endsAt: founding.endsAt,
  intro: {
    eyebrow: 'New here?',
    label: introOffer.headline,
    action: 'See offer',
    href: introOffer.landing.href,
    ariaLabel: `See the intro offer: ${introOffer.pitch}`,
  },
  founding: {
    eyebrow: `Founding rate ends ${founding.deadline}`,
    label: 'Unlimited, locked in for life',
    action: 'Explore',
    href: founding.landing.href,
    ariaLabel: 'Explore the Founding Unlimited membership',
  },
};

export default stickyOfferBar;
