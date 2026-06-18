import type { MenuData } from '../../templates/menu/types.ts';

export const menu: MenuData = {
  eyebrow: 'Menu · 2026',
  heading: 'Drinks',
  items: [
    {
      name: 'LMNT Electrolyte Mix',
      price: '$2.50',
      chips: ['Grapefruit', 'Watermelon', 'Raspberry', 'Orange'],
      // description:
      //  'Salt, magnesium, and potassium.',
    },
    {
      name: 'LMNT Sparkling',
      price: '$5',
      chips: ['Black Cherry', 'Pineapple', 'Lemonade', 'Orange'],
      // description:
        // 'All the hydration of the original LMNT Electrolyte, but with a refreshing sparkling twist.',
    },
    {
      name: 'Athletic Brewing N/A Beer',
      price: '$5',
      chips: ['Free Wave Hazy IPA', 'Run Wild IPA'],
      // description: 'N/A beer you can enjoy with no worries and no hangovers.',
    },
    {
      name: 'Sauna Water',
      price: '$5',
      chips: ['Nordic Spruce', 'Forest Fields', "Superior Coast"],
      // description: 'Botanical beverages to recover and reconnect with our need to be nature.',
    },
    // {
    //   name: 'Athletic Brewing - Run Wild IPA',
    //   price: '$5',
    //   chips: ['Run Wild IPA'],
    //   description: 'A hugely hoppy hazy IPA with a juicy body. A trio of Amarillo, Citra and Mosaic hops generate bodacious aromatics of tangerine, grapefruit, pine and florals for an herbaceous reprieve in all the right places. It’s luscious, smooth, and highly aromatic.'
    // },
    {
      name: 'Dram Adaptogenic',
      price: '$4',
      chips: ['Lavender + Lemon Balm', 'Holy Basil + Lemon'],
      // description:
        // 'Mood-mellowing adaptogens from Colorado.',
    },
    // {
    //   name: 'Dram Adaptogenic · Holy Basil + Lemon',
    //   price: '$4',
    //   description:
    //     'Tulsi with clove and mint notes, brightened by lemon peel and calming passionflower.',
    // },
    {
      name: 'Dram CBD',// · Beauty Bubbles',
      price: '$5',
      chips: ['Beauty Bubbles', 'Sweetgrass'],
      description:
        '25mg CBD + adaptogens ',
    },
    // {
    //   name: 'Dram CBD · Sweetgrass',
    //   price: '$5',
    //   description:
    //     '25mg CBD + Earthy sweetgrass with vanilla, mint, ashwagandha and skullcap. Grounding.',
    // },
  ],
  footer: {
    address: '1000 Westover Hills Blvd.',
  },
};
