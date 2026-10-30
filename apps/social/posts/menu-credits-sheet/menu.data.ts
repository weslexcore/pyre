import type { MenuSheetData } from '../../templates/menu-sheet/types.ts';

export const menu: MenuSheetData = {
  eyebrow: 'Use credits for open hours, guided classes and events',
  heading: 'PRICING',
  feature: {
    label: 'Founding membership',
    name: 'Founding Unlimited',
    price: '$199/mo',
    perks: [
      'Unlimited credits',
      '4 guest passes',
      '15% off drinks, merch and private rentals',
      '15% off partner businesses',
      'Members-only events, chat and merch',
      'Pause up to 3 months in a 12 month period',
    ],
    offer: {
      label: 'Intro offer',
      name: '2 weeks unlimited',
      price: '$50',
      description: 'Become a member during your 2 weeks and take $50 off your first month.',
    },
  },
  categories: [
    {
      title: 'CREDIT PACKS',
      note: 'expire 3 months from purchase',
      items: [
        { name: '2 credits', price: '$45', originalPrice: '$50', note: 'save $5' },
        { name: '4 credits', price: '$85', originalPrice: '$100', note: 'save $15' },
        {
          name: '8 credits',
          price: '$165',
          originalPrice: '$200',
          note: '$20.62 a session · save $35',
        },
      ],
    },
    {
      title: 'SUBSCRIPTIONS',
      note: 'renew monthly',
      items: [
        {
          name: 'circle // 4 credits',
          price: '$75/mo',
          originalPrice: '$100',
          note: 'save $25',
        },
        {
          name: 'ritual // 8 credits',
          price: '$140/mo',
          originalPrice: '$200',
          note: 'save $60',
        },
      ],
    },
  ],
  footnote: 'All credit packs and subscriptions can be shared with friends + family',
};
