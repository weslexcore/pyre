import type { BreakSectionContent } from './types';

const breakSection: BreakSectionContent = {
  elements: {
    headingTop: 'IS A SPACE TO',
    words: ['RECONNECT', 'DISCONNECT', 'MAKE A FRIEND', 'BREATHE', 'HEAL'],
    buttonLabel: 'SPEND TIME WITH US',
    intervalMs: 2000,
  },
  actions: {
    primary: { label: 'Spend time with us', href: '#signup', ariaLabel: 'Spend time with us — jump to signup form' },
  },
};

export default breakSection;


