// Bio-link page (/hi) configuration — the link-in-bio landing page for
// social traffic (Instagram/TikTok). Extremely simple, mobile-first, built
// to convert cold visitors: intro offer up top, link stack, special events,
// email capture.
import type { ImageMetadata } from 'astro';
import logoImg from '../assets/logos/creme/single-pine-tree-white.png';
import giftCards from './gift-cards';
import location from './location';
import { withBase } from './paths';
import sessions from './sessions';

export interface HiLink {
  id: string;
  label: string;
  sublabel?: string;
  href: string;
  ariaLabel?: string;
  external?: boolean;
}

export interface HiContent {
  meta: {
    title: string;
    description: string;
  };
  header: {
    logo: { src: ImageMetadata; alt: string };
    tagline: string;
  };
  hero: {
    pillLabel: string;
    title: string;
    subtitle: string;
    price: number;
    originalPrice: number;
    priceNote: string;
    cta: {
      label: string;
      href: string;
      ariaLabel: string;
    };
  };
  events: {
    heading: string;
    limit: number;
  };
  links: HiLink[];
  contact: {
    label: string;
    sublabel: string;
    methods: HiLink[];
  };
  socials: HiLink[];
  posthogSource: string;
  signupCopy: {
    title: string;
    subtitle: string;
    successMessage: string;
  };
}

const intro = sessions.items.find((item) => item.id === 'intro');

const hi: HiContent = {
  meta: {
    title: 'Pyre Sauna + Cold Plunge | Richmond, VA',
    description:
      "Richmond's community sauna + cold plunge. First time? Buy 1 session, get 1 free. Book a session, browse events, or grab a gift card.",
  },
  header: {
    logo: { src: logoImg, alt: 'Pyre Sauna + Cold Plunge' },

    tagline: 'COMMUNITY + SAUNA + COLD PLUNGE · RVA',
  },
  hero: {
    pillLabel: 'First time?',
    title: 'Intro // Buy 1, Get 1 Free',
    subtitle: 'Two sauna + cold plunge sessions for the price of one.',
    price: 25,
    originalPrice: 50,
    priceNote: 'for 2 credits',
    cta: {
      label: 'Claim Intro Offer',
      href: intro?.href ?? withBase('/events'),
      ariaLabel: 'Claim the intro offer — buy one session, get one free for $25',
    },
  },
  events: {
    heading: 'Upcoming Special Events',
    limit: 3,
  },
  links: [
    {
      id: 'book',
      label: 'Book a Session',
      sublabel: 'See the full schedule',
      href: withBase('/events'),
      ariaLabel: 'Book a sauna session at Pyre',
    },
    {
      id: 'membership',
      label: 'Memberships',
      sublabel: 'From $119/mo — founding rates locked for life',
      href: withBase('#membership'),
      ariaLabel: 'View Pyre membership options',
    },
    {
      id: 'gift-cards',
      label: giftCards.title,
      sublabel: giftCards.subtitle,
      href: giftCards.cta.href,
      ariaLabel: giftCards.cta.ariaLabel,
      external: true,
    },
    // {
    //   id: 'shop',
    //   label: 'Merch',
    //   sublabel: 'Totes, tees + more',
    //   href: withBase('/shop'),
    //   ariaLabel: 'Shop Pyre merch',
    // },
    {
      id: 'visit',
      label: 'Visit Us',
      sublabel: location.address,
      href:
        location.mapsUrl ??
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.address)}`,
      ariaLabel: 'Get directions to Pyre Sauna on Google Maps',
      external: true,
    },
  ],
  contact: {
    label: 'Contact Us',
    sublabel: 'Questions? Reach out anytime',
    // Sourced from location.ts so contact details stay in one place. The
    // phone method only renders once location.phone is filled in.
    methods: [
      {
        id: 'contact-email',
        label: 'Email',
        sublabel: location.email,
        href: `mailto:${location.email}`,
        ariaLabel: `Email Pyre Sauna at ${location.email}`,
      },
      ...(location.phone
        ? [
            {
              id: 'contact-phone',
              label: 'Call or Text',
              sublabel: location.phone,
              href: `tel:${location.phone.replace(/[^0-9+]/g, '')}`,
              ariaLabel: `Call Pyre Sauna at ${location.phone}`,
            },
          ]
        : []),
      {
        id: 'contact-instagram',
        label: 'Instagram',
        sublabel: location.instagram,
        href: location.instagramUrl,
        ariaLabel: 'Message Pyre Sauna on Instagram',
        external: true,
      },
    ],
  },
  socials: [
    {
      id: 'instagram',
      label: 'Instagram',
      href: location.instagramUrl,
      ariaLabel: 'Follow Pyre Sauna on Instagram',
      external: true,
    },
    // {
    //   id: 'tiktok',
    //   label: 'TikTok',
    //   href: 'https://www.tiktok.com/@pyre_sauna',
    //   ariaLabel: 'Follow Pyre Sauna on TikTok',
    //   external: true,
    // },
  ],
  posthogSource: 'hi',
  signupCopy: {
    title: 'Not ready to book?',
    subtitle: "Drop your email below and we'll send first word on our upcoming events and offers.",
    successMessage: "You're on the list. See you at the sauna.",
  },
};

export default hi;
