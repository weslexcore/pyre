import type { BenefitsContent } from './types';

const benefits: BenefitsContent = {
  title: 'Reset & Reconnect',
  subtitle: 'Escape the noise. Find your balance.',
  items: [
    {
      title: 'Melt Away Stress',
      description:
        'The heat-cold contrast activates your parasympathetic nervous system, triggering a deep relaxation response that lowers cortisol and quiets a racing mind.',
    },
    {
      title: 'Recover from Burnout',
      description:
        'Break the cycle of chronic exhaustion. Regular contrast therapy resets your nervous system, restoring the energy and mental clarity modern life depletes.',
    },
    {
      title: 'Connect with Others',
      description:
        'Share the experience in a distraction-free space. No phones, no screens—just real conversation and community in an environment designed for presence.',
    },
  ],
  cta: {
    label: 'Book a Session',
    href: '#',
    ariaLabel: 'Book your first contrast therapy session',
  },
};

export default benefits;
