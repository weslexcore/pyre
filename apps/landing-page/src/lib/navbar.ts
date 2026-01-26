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
        label: 'About',
        href: withBase('#about'),
        ariaLabel: 'Learn about Pyre',
      },
      {
        label: 'Membership',
        href: withBase('#membership'),
        ariaLabel: 'View membership options',
      },
      {
        label: 'Events',
        href: withBase('/events'),
        ariaLabel: 'View upcoming events',
      },
      {
        label: 'FAQ',
        href: withBase('#faq'),
        ariaLabel: 'Frequently asked questions',
      },
      {
        label: 'Blog',
        href: withBase('/blog'),
        ariaLabel: 'Read our blog',
      },
    ],
  },
  actions: {
    primary: {
      label: 'Join Mailing List',
      href: withBase('#signup'),
      ariaLabel: 'Join the mailing list',
    },
    secondary: {
      label: 'Book',
      href: withBase('/book'),
      ariaLabel: 'Book now',
    },
    social: {
      instagram: {
        label: 'Instagram',
        href: 'https://www.instagram.com/pyre_sauna/',
        ariaLabel: 'Follow us on Instagram',
      },
    },
  },
};

export default navbar;
