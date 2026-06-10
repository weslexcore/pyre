import type { PrivateRentalsContent } from './types';

const privateRentals: PrivateRentalsContent = {
  title: 'Private Rentals',
  subtitle: 'Sauna + cold plunge, delivered to you',
  description: [
    'Bring the bathhouse home for a day or longer. We offer one or two fully equipped units—each with a six-person sauna and cold plunge—for private events, recovery weekends, and backyard escapes.',
  ],
  // unitSummary:
  //   'Every unit is sized for up to six people and includes a traditional sauna paired with a cold plunge.',
  periodLabel: '24-hour rental (drop-off to pick-up)',
  logistics: ['We handle drop-off and pick-up. You get a full day with the equipment on site.'],
  // addonSummary: 'Add extra days: +$150 per day for one unit, +$250 per day for two units.',
  tiers: [
    {
      name: 'One unit (6-12 people)',
      price: 650,
      extraDayPrice: 150,
      features: [
        'One six-person sauna + cold plunge',
        '24 hours on site',
        'Delivery & pick-up included',
      ],
      imageAlt: 'Mobile sauna and cold plunge unit for private rental',
    },
    {
      name: 'Two units (12+ people)',
      price: 1200,
      extraDayPrice: 250,
      features: [
        'Two six-person saunas + cold plunges',
        '24 hours on site',
        'Delivery & pick-up included',
      ],
      imageAlt: 'Two mobile sauna and cold plunge units at dusk for private rental',
    },
  ],
  email: 'rentals@pyresauna.com',
  cta: {
    label: 'HIT US UP',
    href: 'mailto:rentals@pyresauna.com?subject=Private%20Rental%20Inquiry',
    ariaLabel: 'Send an email to inquire about a private sauna and cold plunge rental',
  },
};

export default privateRentals;
