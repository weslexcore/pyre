import type { MenuData } from '../../templates/menu/types.ts';

export const menu: MenuData = {
  eyebrow: 'Menu · 2026',
  heading: 'Drinks',
  items: [
    {
      name: 'LMNT Electrolyte Mix',
      price: '$2.50',
      chips: ['Grapefruit', 'Watermelon', 'Raspberry', 'Orange'],
      description: 'OG LMNT Electrolyte mix - salt, magnesium, and potassium to help you stay hydrated and energized.'
    },
    {
      name: 'LMNT Sparkling',
      price: '$5',
      chips: ['Black Cherry', 'Pineapple', 'Lemonade', 'Orange'],
      description: 'All the hydration of the original LMNT Electrolyte, but with a refreshing sparkling twist.'
    },
    {
      name: 'Athletic Brewing N/A Beer',
      price: '$5',
      chips: ['Free Wave Hazy IPA', 'Run Wild IPA'],
      description: 'N/A beer you can enjoy anytime and anywhere, with no worries and no hangovers.'
    },
    {
      name: 'Mocktails',
      price: '$5',
      chips: ['DeSoi', 'Recess'],
      description: 'Mocktails made with adaptogens and herbs to help you relax and unwind.'
    },
    // {
    //   name: 'Athletic Brewing - Run Wild IPA',
    //   price: '$5',
    //   chips: ['Run Wild IPA'],
    //   description: 'A hugely hoppy hazy IPA with a juicy body. A trio of Amarillo, Citra and Mosaic hops generate bodacious aromatics of tangerine, grapefruit, pine and florals for an herbaceous reprieve in all the right places. It’s luscious, smooth, and highly aromatic.'
    // },
    // {
    //   name: 'Dram Adaptogenic · Lavender + Lemon Balm',
    //   price: '$4',
    //   description:
    //     'Mood-mellowing florals from Colorado lavender, lifted by citrusy lemon balm.',
    // },
    // {
    //   name: 'Dram Adaptogenic · Holy Basil + Lemon',
    //   price: '$4',
    //   description:
    //     'Tulsi with clove and mint notes, brightened by lemon peel and calming passionflower.',
    // },
    // {
    //   name: 'Dram CBD · Beauty Bubbles',
    //   price: '$5',
    //   description:
    //     '25mg CBD + Rose-forward CBD with silver ear mushroom and CoQ10 — for skin and glow.',
    // },
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
