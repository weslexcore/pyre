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
  title: 'Credits',
  subtitle: 'Can be used for any 2 hour open hours, guided class or select special events.',
  note: 'Credits can be shared with friends & family! 2-Pack Intro is non-transferrable. ',
  items: [
    {
      id: 'single',
      name: 'Single - 1 Credit',
      price: 39,
      description: 'Drop-in visit',
      href: '/book',
    },
    {
      id: 'intro',
      name: 'Buy 1, Get 1 Free - 2 Credits',
      price: 39,
      description: 'New here? Start with two sessions and see how it feels. Available once per customer.',
      highlighted: true,
      href: 'https://momence.com/m/630918',
    },
    {
      id: 'pack-2',
      name: 'Duo - 2 Credits',
      price: 72,
      description: 'Come once, then come back - or bring someone along.',

      href: 'https://momence.com/m/702636',
    },
    {
      id: 'pack-4',
      name: 'Circle - 4 Credits',
      price: 129,
      description: 'Build momentum - come back often or bring your circle.',
      href: 'https://momence.com/m/630915',
    },
    {
      id: 'pack-8',
      name: 'Ritual - 8 Credits',
      price: 229,
      highlighted: true,
      description: 'Our best value - designed for consistency, connection, and shared experiences.',
      href: 'https://momence.com/m/630916',
    },
  ],
};

export default sessions;
