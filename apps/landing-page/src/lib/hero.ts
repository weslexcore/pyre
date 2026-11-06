// Homepage hero calls to action. The intro offer is the primary action for
// first-time visitors; booking a session is the secondary one. The intro
// button sends people to the /intro landing page (no price here; it is shown
// there at checkout), with the wording coming from sessions.ts.
import { withBase } from './paths';
import { introOffer } from './sessions';

const heroOffer = {
  eyebrow: 'New here?',
  primary: {
    label: `Try ${introOffer.headline}`,
    href: introOffer.landing.href,
    ariaLabel: `See the intro offer: ${introOffer.pitch}`,
  },
  secondary: {
    label: 'Book a Session',
    href: withBase('/events'),
    ariaLabel: 'Browse and book upcoming sessions',
  },
  trust: 'Certified sauna masters · Beginners welcome',
};

export default heroOffer;
