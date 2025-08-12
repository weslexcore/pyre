import type { ExperiencesContent } from './types';

const experiences: ExperiencesContent = {
  elements: {
    title: 'EXPERIENCES',
    items: [
      {
        title: 'SOCIAL',
        icon: {
          src: '/symbols/connection-symbol.png',
          alt: 'Symbol representing connection and community',
        },
        description: '50 person Scandinavian sauna, large hot pool, teas and tonics, lounge seating',
        bullets: ['Cultivating connection', 'Encouraging understanding', 'Enjoying Life'],
        link: { href: '/social', label: 'Join us for social connection' },
        linkText: 'Join us for social connection',
      },
      {
        title: 'MEDITATIVE',
        icon: {
          src: '/symbols/harmony-symbol.png',
          alt: 'Symbol representing calm and balance',
        },
        description: 'A 20 person sauna, 20 person cold plunge, space for breathwork + bodywork',
        bullets: ['Disconnecting from technology', 'Finding meaning'],
        link: { href: '/meditative', label: 'Go inward' },
        linkText: 'Go inward',
      },
      {
        title: 'GUIDED',
        icon: {
          src: '/symbols/transformation-symbol.png',
          alt: 'Symbol representing growth and transformation',
        },
        description:
          'Guided classes that blend the thermic cycle (sauna, cold bathing, and resting) with meditation, breathwork, sound baths and more',
        bullets: ['Prioritizing one’s health', 'Self-care'],
        link: { href: '/classes', label: 'View Experiences' },
        linkText: 'View Experiences',
      },
    ],
  },
};

export default experiences;


