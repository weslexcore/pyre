import type { ActionRef } from './types';

export interface SessionItem {
  id: string;
  name: string;
  price: number;
  description: string;
  highlighted?: boolean;
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
  subtitle: 'Drop in anytime during open hours',
  note: 'Packs are transferrable - share with friends & family',
  items: [
    {
      id: 'single',
      name: 'Single Session',
      price: 35,
      description: 'Drop-in visit',
    },
    {
      id: 'intro',
      name: 'Intro Offer',
      price: 49,
      description: '2 sessions for new guests',
      highlighted: true,
    },
    {
      id: 'pack-4',
      name: '4 Session Pack',
      price: 119,
      description: 'Save $21',
    },
   
  ],
  cta: {
    label: 'Book a Session',
    href: '/book',
    ariaLabel: 'Book a sauna session',
  },
};

export default sessions;
