import type { MenuSheetData } from '../../templates/menu-sheet/types.ts';

export const menu: MenuSheetData = {
  eyebrow: '',
  heading: 'DRINKS',
  categories: [
    {
      title: 'LMNT',
      items: [
        {
          name: 'mix',
          price: '$2.5',
          chips: ['grapefruit', 'watermelon', 'raspberry', 'orange'],
          // description: 'Salt, magnesium, and potassium.',
        },
        {
          name: 'sparkling',
          price: '$5',
          chips: ['black cherry', 'pineapple', 'lemonade', 'orange'],
          // description: 'All the hydration of the original LMNT Electrolyte, but with a refreshing sparkling twist.',
        },
      ],
    },
    {
      title: 'DRAM APOTHECARY',
      items: [
        {
          name: 'lavender + lemon balm',
          price: '$5'
        },
        {
          name: 'holy basil + lemon',
          price: '$5'
        },
        {
          name: 'beauty bubbles cbd',
          price: '$6',
          description: '25mg cbd + coq10 + bilberry, rose petal',
        },
        {
          name: 'sweetgrass cbd',
          price: '$6',
          // chips: ['Lavender + Lemon Balm', 'Holy Basil + Lemon'],
          description: '25mg cbd + wild mint, vanilla, oatstraw',
        },
      ],
    },
    {
      title: 'Sauna Water',
      items: [
        {
          name: 'nordic spruce',
          price: '$5',
          description: 'fresh spruce tips, aromatic cardamom, juniper berries, pressed lemon, unrefined mineralized sea salt',
        },
        {
          name: 'forest fields',
          price: '$5',
          description: 'blood orange, calming chamomile, warming ginger, antioxidant-rich sumac, unrefined mineralized sea salt',
        },
        {
          name: 'superior coast',
          price: '$5',
          description: 'pressed lime, hyssop, elderflower, sage, juniper, unrefined mineralized sea salt',
        },
      ],
    },
    {
      title: 'athletic brewing n/a beer',
      items: [
        {
          name: 'free wave hazy ipa',
          price: '$5',
          // chips: ['Free Wave Hazy IPA', 'Run Wild IPA'],
          description: 'tangerine, grapefruit, pine',
        },
        {
          name: 'run wild ipa',
          price: '$5',
          // chips: ['Free Wave Hazy IPA', 'Run Wild IPA'],
          description: 'citrus, pine, malt',
        },
      ],
    },
  ],
};
