import type { BenefitsContent } from './types';

const benefits: BenefitsContent = {
  title: 'Benefits of Contrast Therapy',
  subtitle: 'Ancient wisdom, modern science',
  items: [
    {
      title: 'Enhanced Recovery',
      description:
        'Accelerate muscle recovery and reduce inflammation through alternating heat and cold exposure.',
    },
    {
      title: 'Improved Circulation',
      description:
        'Stimulate blood flow and cardiovascular health through thermal cycling.',
    },
    {
      title: 'Mental Clarity',
      description:
        'Trigger endorphin release and reduce cortisol for improved focus and mood.',
    },
    {
      title: 'Better Sleep',
      description:
        'Regulate your circadian rhythm and promote deeper, more restorative sleep.',
    },
    {
      title: 'Immune Support',
      description:
        'Strengthen your immune system through regular thermal stress adaptation.',
    },
    {
      title: 'Stress Relief',
      description:
        'Activate your parasympathetic nervous system and build resilience to daily stressors.',
    },
  ],
  cta: {
    label: 'Book a Session',
    href: '#',
    ariaLabel: 'Book your first contrast therapy session',
  },
};

export default benefits;
