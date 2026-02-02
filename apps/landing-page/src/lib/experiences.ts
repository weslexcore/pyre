import type { BenefitsContent } from './types';
import { withBase } from './paths';

const benefits: BenefitsContent = {
  title: 'Experiences',
  subtitle: 'Escape the noise. Find your balance.',
  items: [
    {
      icon: 'community',
      title: 'Free Flow',
      description:
        'Move at your own pace over 2 hours. Meet a new friend. Take a moment for yourself. This time is yours.',
    },
    {
      icon: 'harmony',
      title: 'Guided Sessions',
      description:
        "Enjoy a curated experience designed to help release tension and connect with others.",
    },
    {
      icon: 'ritual',
      title: 'Special Events',
      description:
        "The ancient power of sauna and cold bathing blended with new modalities. Sound baths, breathwork, drumming, guided meditations, communal healing; a new way to connect.",
    },
  ],
  closing: "You'll leave feeling better than when you walked in.",
  cta: {
    label: 'Book a Session',
    href: withBase('/events'),
    ariaLabel: 'Book your first contrast therapy session',
  },
};

export default benefits;
