import { withBase } from './paths';
import type { FooterContent } from './types';
import saunaMasterCert from '../assets/logos/sauna_master_cert.png';

const footerConfig: FooterContent = {
  elements: {
    hoursHeading: 'Hours',
    hoursText: 'Coming Soon',
    locationHeading: 'Location',
    locationText: 'Coming Soon',
    contactHeading: 'Contact',
    copyright: `© ${new Date().getFullYear()} Pyre Sauna. All rights reserved.`,
  },

  groups: [
    {
      title: 'Sessions',
      links: [
        {
          label: 'Book a session',
          href: withBase('/book'),
          ariaLabel: 'Book now',
        },
      ],
    },
    {
      title: 'Resources',
      links: [
        {
          label: 'Blog',
          href: withBase('/blog'),
          ariaLabel: 'Read our blog',
        },
      ],
    },
    {
      title: 'Contact',
      links: [
        {
          href: 'https://instagram.com/pyre_sauna',
          label: 'Instagram',
          ariaLabel: 'Pyre Sauna on Instagram',
          icon: 'instagram',
        },
        {
          label: 'hi@pyresauna.com',
          href: 'mailto:hi@pyresauna.com',
          ariaLabel: 'Email hi@pyresauna.com',
        },
        // { label: 'Contact Us', href: '/contact' },
      ],
    },
    // {
    //   title: 'Press',
    //   links: [
    //     {
    //       label: 'Press & News',
    //       href: 'mailto:press@pyresauna.com?subject=Press%20Inquiry%20-%20Pyre%20Sauna',
    //       ariaLabel: 'Email press@pyresauna.com for press inquiries',
    //     },
    //   ],
    // },
    // {
    //   title: 'Support',
    //   links: [

    //     // { label: 'FAQs', href: '/faqs' },
    //     // { label: 'Health & Safety', href: '/health-and-safety' },
    //   ],
    // },
    // {
    //   title: 'Company',
    //   links: [
    //     { label: 'Our Mission', href: '/mission' },
    //   ],
    // },
    {
      title: 'Legal',
      links: [
        { label: 'Privacy Policy', href: withBase('/privacy-policy') },
        { label: 'Cookie Policy', href: withBase('/cookie-policy') },
        { label: 'Terms of Service', href: withBase('/terms-of-service') },
      ],
    },
  ],
  certification: {
    image: {
      src: saunaMasterCert.src,
      alt: 'Deutsche Sauna-Akademie Certified Sauna Master',
    },
    title: 'Deutsche Sauna-Akademie Certified Sauna Master',
    link: 'https://saunameister.de/',
    ariaLabel: 'Visit Deutsche Sauna-Akademie - Certified Sauna Master credential',
  },
};

export default footerConfig;
