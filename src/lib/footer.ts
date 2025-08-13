import type { FooterContent } from './types';

const footerConfig: FooterContent = {
  images: {
    brandMark: { src: '/logos/creme/logo.png', alt: 'Pyre Sauna + Cold Plunge logo' },
  },
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
      title: "Contact",
      links: [
        {
          label: 'hi@pyresauna.com',
          href: 'mailto:hi@pyresauna.com',
          ariaLabel: 'Email hi@pyresauna.com',
        },
        {
          href: 'https://instagram.com/pyre_sauna',
          label: 'Instagram',
          ariaLabel: 'Pyre Sauna on Instagram',
          icon: 'instagram',
        },
      ]
    },
    {
      title: 'Press',
      links: [
        {
          label: 'Press & News',
          href: 'mailto:press@pyresauna.com?subject=Press%20Inquiry%20-%20Pyre%20Sauna',
          ariaLabel: 'Email press@pyresauna.com for press inquiries',
        },
      ],
    },
    {
      title: 'Support',
      links: [
        { label: 'Contact Us', href: '/contact' },
        { label: 'FAQs', href: '/faqs' },
        { label: 'Health & Safety', href: '/health-and-safety' },
      ],
    },
    {
      title: 'Company',
      links: [
        { label: 'Our Mission', href: '/mission' },
      ],
    },
    {
      title: 'Legal',
      links: [
        { label: 'Privacy Policy', href: '/privacy-policy' },
        { label: 'Cookie Policy', href: '/cookie-policy' },
        { label: 'Terms of Service', href: '/terms-of-service' },
      ],
    },
  ],
};

export default footerConfig;


