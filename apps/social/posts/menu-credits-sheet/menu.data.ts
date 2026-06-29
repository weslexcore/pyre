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
          price: '$25',
          originalPrice: '$50',
          description: 'first-timers · once per customer, non-transferrable',
        },
        { name: 'single // 1 credit', price: '$25' }, // description: 'drop-in visit' },
        { name: 'duo // 2 credits', price: '$45', originalPrice: '$50' },
        { name: 'circle // 4 credits', price: '$85', originalPrice: '$100' },
        {
          name: 'ritual // 8 credits',
          price: '$165',
          originalPrice: '$200',
          description: 'best value',
          highlighted: true,
        }
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
            'free bathhouse tote',
            '4 guest passes/mo',
            '10% off drinks + merch',
            'only 30 available',
          ],
          description: 'discount for life · billing begins july 2026',
        },
        {
          name: 'founding limited',
          price: '$119/mo',
          originalPrice: '$200',
          chips: [
            "8 credits/mo",
            '1 guest pass/mo',
            '10% off drinks + merch',
            'only 30 available',
          ],
          description: 'discount for life · billing begins july 2026',
        },
      ],
    },
  ],
};
