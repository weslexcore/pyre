import type { MenuSheetData } from '../../templates/menu-sheet/types.ts';

export const menu: MenuSheetData = {
  eyebrow: 'Use credits for open hours, guided classes, + select events',
  heading: 'PRICING',
  categories: [
    {
      title: 'CREDITS',
      items: [
        {
          name: 'intro // 2 credits',
          price: '$39',
          originalPrice: '$78',
          description: 'first-timers · once per customer, non-transferrable',
        },
        { name: 'single // 1 credit', price: '$39',},// description: 'drop-in visit' },
        { name: 'duo // 2 credits', price: '$72', originalPrice: '$78' },
        { name: 'circle // 4 credits', price: '$129', originalPrice: '$156' },
        {
          name: 'ritual // 8 credits',
          price: '$229',
          originalPrice: '$312',
          description: 'best value',
          highlighted: true,
        },
      ],
    },
    {
      title: 'MEMBERSHIPS',
      items: [
        {
          name: 'founding unlimited',
          price: '$199/mo',
          originalPrice: '$249',
          chips: [
            // 'unlimited for life',
            'free tote',
            '4 guest passes/mo',
            '10% off extra guests',
            'only 30 available',
          ],
          description: 'discount for life · billing begins july 2026',
        },
      ],
    },
  ],
};
