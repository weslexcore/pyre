import type { ActionRef } from './types';

export interface SessionItem {
  id: string;
  name: string;
  price: number;
  originalPrice?: number;
  description: string;
  savings?: number;
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
  title: 'Credits',
  subtitle:
    '1 credit = 1 hour session',
  note: 'All credits except our "Intro Offer" can be shared with friends & family!',
  items: [
    {
      id: 'intro',
      name: 'Intro // 2 Credits',
      price: 25,
      originalPrice: 50,
      description:
        'New here? Start with two credits and see how it feels. Available once per customer. Not shareable.',
      savings: 25,
      highlighted: true,
      href: 'https://momence.com/m/630918',
    },
    {
      id: 'single',
      name: 'Single // 1 Credit',
      price: 25,
      description: 'Drop-in visit',
      href: '/events',
    },
    {
      id: 'pack-2',
      name: 'Duo // 2 Credits',
      price: 45,
      originalPrice: 50,
      description: 'Come twice, stay for a longer session, or bring along a friend.',
      savings: 5,

      href: 'https://momence.com/m/702636',
    },
    {
      id: 'pack-4',
      name: 'Circle // 4 Credits',
      price: 85,
      originalPrice: 100,
      description: 'Build momentum - come back often or bring your circle.',
      savings: 15,
      href: 'https://momence.com/m/630915',
    },
    {
      id: 'pack-8',
      name: 'Ritual // 8 Credits',
      price: 165,
      originalPrice: 200,
      savings: 35,
      highlighted: true,
      description: 'Our best value - designed for consistency, connection, and shared experiences.',
      href: 'https://momence.com/m/630916',
    },
  ],
};

export default sessions;
