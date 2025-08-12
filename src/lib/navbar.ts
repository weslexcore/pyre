import type { NavbarContent } from './types';

const navbar: NavbarContent = {
  images: {
    brandMark: { src: '/logos/creme/logo_with_text.png', alt: 'Pyre Sauna + Cold Plunge' },
  },
  elements: {
    ariaLabel: 'Pyre Sauna Home',
  },
  actions: {
    primary: {
      label: 'Join the mailing list',
      href: '#signup',
      ariaLabel: 'Join the mailing list',
    },
  },
};

export default navbar;


