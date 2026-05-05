import { withBase } from './paths';
import type { NavbarContent } from './types';

const navbar: NavbarContent = {
  images: {
    brandMark: {
      src: '/logos/creme/logo_with_text.png',
      alt: 'Pyre Sauna + Cold Plunge',
    },
  },
  elements: {
    ariaLabel: 'Pyre Sauna Home',
    links: [
      {
        label: 'About',
        href: withBase('#about'),
        ariaLabel: 'Learn about Pyre',
      },
      // {
      //   label: 'Membership',
      //   href: withBase('#membership'),
      //   ariaLabel: 'View membership options',
      // },
      {
        label: 'Events',
        href: withBase('/events'),
        ariaLabel: 'View upcoming events',
      },
      {
        label: 'Work Trade',
        href: withBase('/work-trade'),
        ariaLabel: 'Volunteer with Pyre and earn session credits',
      },
      {
        label: 'Credits',
        href: withBase('#sessions'),
        ariaLabel: 'View Credits options',
      },
      {
        label: 'Memberships',
        href: withBase('#membership'),
        ariaLabel: 'View Memberships options',
      },
      {
        label: 'FAQ',
        href: withBase('#faq'),
        ariaLabel: 'Frequently asked questions',
      },
      {
        label: 'Shop',
        href: withBase('/shop'),
        ariaLabel: 'Browse Pyre merchandise',
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
      label: 'Get Early Access',
      href: '#signup',
      ariaLabel: 'Get early access to Pyre',
    },
    secondary: {
      label: 'Book',
      href: withBase('/events'),
      ariaLabel: 'Book now',
    },
    login: {
      label: 'Login',
      href: '/api/auth/login',
      ariaLabel: 'Log in to manage your bookings',
    },
    social: {
      instagram: {
        label: 'Instagram',
        href: withBase('/events'),
        ariaLabel: 'Follow us on Instagram',
      },
    },
  },
};

export default navbar;
