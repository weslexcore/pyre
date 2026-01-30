import type { BenefitsContent } from './types';
import { withBase } from './paths';

const benefits: BenefitsContent = {
  title: 'Reset & Reconnect',
  subtitle: 'Escape the noise. Find your balance.',
  items: [
    {
      title: 'Melt Into the Heat',
      description:
        "As you settle into the sauna, your body softens. The noise fades, allowing your mind and body to settle.",
    },
    {
      title: 'Refresh in the Cold',
      description:
        'Cold is immediate and brings a steady sense of ease and clarity that stays with you long after you leave.',
    },
    {
      title: 'Feel Human Together',
      description:
        "Pyre is a technology-free space designed for connection. This is the place to slow down and remember we're not alone.",
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
