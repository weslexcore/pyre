import type { ActionRef } from './types';

export interface SessionItem {
  id: string;
  name: string;
  price: number;
  description: string;
  highlighted?: boolean;
  href?: string;
}

export interface SessionsContent {
  title: string;
  subtitle?: string;
  note?: string;
  items: SessionItem[];
  cta?: ActionRef;
}

const sessions: SessionsContent = {
  title: 'Session Prices',
  subtitle: 'Drop in anytime',
  note: '2-Pack Intro is non-transferrable. Other packs can be shared with friends & family!',
  items: [
    {
      id: 'single',
      name: 'Single Session',
      price: 39,
      description: 'Drop-in visit',
      href: '/book',
    },
    {
      id: 'intro',
      name: '2-Pack Intro',
      price: 49,
      description: '2 sessions for new guests',
      highlighted: true,
      href: 'https://momence.com/Pyre/membership/2-Pack-Intro/630918',
    },
    {
      id: 'pack-4',
      name: '4-Pack',
      price: 119,
      description: 'Save $21',
      href: 'https://momence.com/Pyre/membership/4-Pack/630915',
    },
    {
      id: 'pack-8',
      name: '8-Pack',
      price: 229,
      description: 'Save $51',
      href: 'https://momence.com/Pyre/membership/8-Pack/630916',
    },
  ],
};

export default sessions;
