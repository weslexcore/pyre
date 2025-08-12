import type { StoryContent } from './types';

const story: StoryContent = {
  images: {
    background: {
      src: '/images/sauna_ladle_multiexposure.jpeg',
      alt: 'Multi-exposure photograph of a wooden sauna ladle evoking ritual and heat.',
    },
    symbol: { src: '/symbols/sauna-symbol.png', alt: 'Sauna symbol' },
  },
  elements: {
    title: 'RITUALS FOR MODERN LIFE',
    // emphasisList: ['Yourself', 'Your Community', 'The Present Moment'],
    body: [
      "Pyre is a space that can be experienced alone or together. A space that serves as a balancing force to modern life’s demands and stressors. Pyre is a space to reconnect to what really matters:",
      'Yourself',
      'Your Community', 
      'The Present Moment',
      'Centered around healing practices that have been around for thousands of years, we’ve re-imagined European bathhouse culture for Richmond.',
      'A space where you can take a quiet moment alone in our silent sauna, where you can connect with friends and strangers in our social lounge. Where you can relieve anxiety in our cold pool. Where you can take guided classes that pair sauna and cold bathing with breathwork, meditation, expression, sound, and many other modalities with the goal of helping us all heal. When you leave Pyre you will feel better than when you walked in. This is a new way to connect.',
      'Come experience change for yourself.',
    ],
  },
  actions: {
    primary: {
      label: 'Join the Waitlist',
      href: '#signup',
      ariaLabel: 'Join the waitlist — jump to signup form',
    },
  },
};

export default story;


