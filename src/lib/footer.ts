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
  },
  actions: {
    contactEmail: 'hi@pyresauna.com',
    instagram: {
      href: 'https://instagram.com/pyresauna',
      label: 'Instagram',
      ariaLabel: 'Pyre Sauna on Instagram',
    },
  },
};

export default footerConfig;


