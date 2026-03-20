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
  title: 'Packs & Pricing',
  // subtitle: 'Drop in anytime',
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
      name: 'First Visit - 2 Pack',
      price: 49,
      description: 'New here? Start with two sessions and see how it feels.',
      highlighted: true,
      href: 'https://momence.com/Pyre/membership/2-Pack-Intro/630918',
    },
    {
      id: 'pack-2',
      name: 'Duo - 2 Pack',
      price: 72,
      description: 'Perfect for a date or connecting with a friend.',

      href: 'https://momence.com/Pyre/membership/2-Pack-Intro/630918',
    },
    {
      id: 'pack-4',
      name: 'Circle - 4 Pack',
      price: 129,
      description: 'Build momentum - come back often or bring your circle.',
      href: 'https://momence.com/Pyre/membership/4-Pack/630915',
    },
    {
      id: 'pack-8',
      name: 'Ritual - 8 Pack',
      price: 229,
      highlighted: true,
      description: 'Our best value - designed for consistency, connection, and shared experiences.',
      href: 'https://momence.com/Pyre/membership/8-Pack/630916',
    },
  ],
};

export default sessions;
