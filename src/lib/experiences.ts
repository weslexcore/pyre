import type { ExperiencesContent } from './types';

const experiences: ExperiencesContent = {
  elements: {
    title: 'EXPERIENCES',
    items: [
      {
        title: 'SAUNA',
        icon: 'connection',
        description: 'Traditional Scandinavian Dry Saunas heated between 170° - 200°',
        bullets: ['Eases Anxiety', 'Promotes Social Connection', 'Improves Sleep'],
        link: { href: '/sauna', label: 'Join us for a sauna' },
        linkText: 'Join us for a sauna',
      },
      {
        title: 'COLD BATHING',
        icon: 'harmony',
        description: 'Cold Plunges between 32° - 50°',
        bullets: ['Improves mood', 'Builds Resilience', 'Boosts Dopamine', 'Reduces Inflammation'],
        link: { href: '/meditative', label: 'Go inward' },
        linkText: 'Go inward',
      },
      {
        title: 'SPECIAL EVENTS',
        icon: 'transformation',
        description:
          'Sauna and Cold Bathing paired with',
        bullets: ['Breath Work, Meditation, Movement', 'Social Evenings: DJ sets, Social Tonics and N/A Cocktails', 'Sound Baths, Drumming, Poetry Reading, Art, Etc.'],
        link: { href: '/classes', label: 'View Experiences' },
        linkText: 'View Experiences',
      },
    ],
  },
};

export default experiences;


