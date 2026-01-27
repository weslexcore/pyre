import type { BenefitsContent } from './types';

const benefits: BenefitsContent = {
  title: 'Reset & Reconnect',
  subtitle: 'Escape the noise. Find your balance.',
  items: [
    {
      title: 'Melt Into the Heat',
      description:
        "As you settle into the sauna, your body softens. Muscles release. Breath slows. Tension you didn't know you were holding begins to let go. The noise fades, allowing your mind and body to settle.",
    },
    {
      title: 'Refresh in the Cold',
      description:
        'Cold is immediate and clarifying. It pulls you fully into the present, releasing tension and sharpening focus. What lingers after is a steady sense of ease and clarity that stays with you long after you leave.',
    },
    {
      title: 'Feel Human Together',
      description:
        "Pyre is a technology-free space designed for connection. Shared heat. Shared cold. Shared presence without distraction or performance. In a world constantly demanding your attention, this is a place to slow down together—to remember we're not alone, and that connection can be effortless.",
    },
  ],
  closing: "You'll leave feeling better than when you walked in.",
  cta: {
    label: 'Book a Session',
    href: '#',
    ariaLabel: 'Book your first contrast therapy session',
  },
};

export default benefits;
