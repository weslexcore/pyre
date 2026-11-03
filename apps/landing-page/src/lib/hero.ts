// Homepage hero calls to action. The intro offer is the primary action for
// first-time visitors; booking a session is the secondary one. Prices and the
// checkout link come from sessions.ts so they stay in sync with the rest of the site.
import { withBase } from './paths';
import { introOffer } from './sessions';

const heroOffer = {
  eyebrow: 'New here?',
  primary: {
    label: `Try ${introOffer.headline} · $${introOffer.price}`,
    href: introOffer.href,
    ariaLabel: `Buy the intro offer: ${introOffer.sentence.toLowerCase()}`,
  },
  secondary: {
    label: 'Book a Session',
    href: withBase('/events'),
    ariaLabel: 'Browse and book upcoming sessions',
  },
  trust: 'Certified sauna masters · Beginners welcome',
};

export default heroOffer;
