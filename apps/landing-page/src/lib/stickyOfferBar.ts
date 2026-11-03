// Copy for the mobile sticky offer bar (components/StickyOfferBar.astro).
import { founding } from './membership';
import { introOffer } from './sessions';

const stickyOfferBar = {
  /** The founding variant is dropped after this time (visitor's clock). */
  endsAt: founding.endsAt,
  intro: {
    eyebrow: 'New here?',
    label: `${introOffer.headline} · $${introOffer.price}`,
    action: 'Claim',
    href: introOffer.href,
    ariaLabel: `Buy the intro offer: ${introOffer.sentence.toLowerCase()}`,
    placement: 'sticky_bar_intro',
  },
  founding: {
    eyebrow: `Founding rate ends ${founding.deadline}`,
    label: `Unlimited · $${founding.unlimited.price}/mo for life`,
    action: 'Join',
    href: founding.unlimited.href,
    ariaLabel: `Claim the Founding Unlimited membership: $${founding.unlimited.price} per month for life`,
    placement: 'sticky_bar_founding',
  },
};

export default stickyOfferBar;
