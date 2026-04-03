import type { BenefitsContent } from './types';
import { withBase } from './paths';

const benefits: BenefitsContent = {
  title: 'Experiences',
  subtitle: 'Escape the noise. Find your balance.',
  items: [
    {
      icon: 'community',
      title: 'Open Hours',
      description:
        'Move between our saunas and cold plunges at your own pace. Meet a new friend. Take a moment for yourself. This time is yours.',
    },
    {
      icon: 'harmony',
      title: 'Guided Sessions',
      description:
        'Curated experiences created by our certified sauna masters blending: Sauna, cold plunge, breathwork, movement, guided questions, and more. A guided reset in community.',
    },
    {
      icon: 'ritual',
      title: 'Special Events',
      description:
        'The ancient power of sauna and cold bathing blended with complimentary modalities: yoga, sound baths, breathwork, drumming, guided meditations, communal healing; a new way to connect.',
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
