import type { ExperiencesContent } from './types';

const experiences: ExperiencesContent = {
  elements: {
    title: 'OFFERINGS',
    items: [
      {
        title: 'SAUNA',
        icon: 'connection',
        description: 'A moment of ease.',
        bullets: [
          'Melt away daily anxieties and make space to reconnect. Improve blood flow, sleep better, make a new friend. You’ll feel better than when you walked in. ',
        ],
        link: { href: '/sauna', label: 'Join us for a sauna' },
        linkText: 'Join us for a sauna',
      },
      {
        title: 'COLD BATHING',
        icon: 'harmony',
        description: 'A moment of stillness.',
        bullets: [
          'Nurture your capacity to feel while exploring resilience. Increase dopamine, lower inflammation, and improve your immune system in just a few minutes. ',
        ],
        link: { href: '/meditative', label: 'Go inward' },
        linkText: 'Go inward',
      },
      {
        title: 'SPECIAL EVENTS',
        icon: 'transformation',
        description: 'A blank canvas.',
        bullets: [
          'The ancient power of sauna and cold bathing blended with new modalities. Sound baths, breathwork, drumming, guided meditations, communal healing; a new way to connect. ',
        ],
        link: { href: '/classes', label: 'View Experiences' },
        linkText: 'View Experiences',
      },
    ],
  },
};

export default experiences;
