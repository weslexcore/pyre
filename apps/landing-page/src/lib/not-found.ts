import type { ActionRef } from './types';

export interface NotFoundContent {
  pageTitle: string;
  description: string;
  elements: {
    code: string;
    heading: string;
    body: string;
  };
  actions: {
    primary: ActionRef;
    secondary: ActionRef;
  };
}

const notFound: NotFoundContent = {
  pageTitle: 'Page Not Found | Pyre Sauna + Cold Plunge',
  description:
    'This page has drifted off like steam. Head back to Pyre Sauna + Cold Plunge in Richmond, VA.',
  elements: {
    code: '404',
    heading: 'THIS PAGE GOT LOST IN THE STEAM',
    body: 'Like a good löyly, it rose, swirled, and vanished. Take a breath, cool off, and find your way back to the hot room.',
  },
  actions: {
    primary: {
      label: 'Back to the heat',
      href: '/',
      ariaLabel: 'Back to the heat — return to the Pyre homepage',
    },
    secondary: {
      label: 'Book a session',
      href: '/events',
      ariaLabel: 'Book a sauna session',
    },
  },
};

export default notFound;
