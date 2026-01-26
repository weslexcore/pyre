import type { AboutContent } from './types';

const about: AboutContent = {
  title: 'About the Club',
  body: [
    'Pyre is a modern bathhouse dedicated to the ancient practice of contrast therapy. We combine traditional Finnish sauna with cold plunge immersion to create a space for physical recovery, mental clarity, and genuine community.',
  ],
  expandedBody: [
    'Our facilities feature hand-crafted Finnish saunas built with sustainably sourced wood, cold plunge pools maintained at optimal temperatures, and thoughtfully designed spaces for relaxation and connection.',
    'Whether you\'re an athlete seeking recovery, a professional managing stress, or simply someone looking for a moment of peace, Pyre offers a sanctuary from the noise of modern life.',
    'We believe in the power of heat and cold to transform not just bodies, but minds and communities. Join us and discover what intentional wellness feels like.',
  ],
  cta: {
    label: 'Learn More',
    href: '/about',
    ariaLabel: 'Learn more about Pyre',
  },
};

export default about;
