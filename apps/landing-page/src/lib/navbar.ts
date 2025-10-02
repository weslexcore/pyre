import { withBase } from './paths';
import type { NavbarContent } from './types';

const navbar: NavbarContent = {
  images: {
    brandMark: { src: '/logos/creme/logo_with_text.png', alt: 'Pyre Sauna + Cold Plunge' },
  },
  elements: {
    ariaLabel: 'Pyre Sauna Home',
    links: [
      {
        label: 'Blog',
        href: withBase('/blog'),
        ariaLabel: 'Read our blog',
      },
    ],
  },
  actions: {
    primary: {
      label: 'Join the mailing list',
      href: withBase('#signup'),
      ariaLabel: 'Join the mailing list',
    },
    secondary: {
      label: 'Book a session',
      href: withBase('/book'),
      ariaLabel: 'Book now',
    },
  },
};

export default navbar;
