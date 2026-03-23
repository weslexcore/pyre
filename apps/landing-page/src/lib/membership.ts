import type { MembershipContent } from './types';

const membership: MembershipContent = {
  title: 'Memberships',
  subtitle: 'Choose the plan that fits your practice',
  note: 'Memberships are nontransferrable',
  tiers: [
    {
      id: '4-sessions',
      name: 'Limited',
      price: 99,
      period: '/month',
      description: 'SAVE $57',
      features: [
        { text: '4 sauna & cold plunge sessions' },
        { text: 'Credits rollover 1 month', highlighted: true },
        { text: '10% off extra sessions', highlighted: true },
      ],
      cta: {
        label: 'Get Started',
        href: 'https://momence.com/m/633377',
        ariaLabel: 'Sign up for 4 sessions per month membership',
      },
    },
    {
      id: 'unlimited',
      name: 'Unlimited',
      price: 249,
      period: '/month',
      description: 'Unlimited access for dedicated practitioners',
      popular: true, 
      features: [
        { text: 'Unlimited sauna & cold plunge access' },
        { text: 'Free Pyre tote bag', highlighted: true },
        { text: '4 guest passes per month ($156 value)', highlighted: true },
        { text: '10% off extra guest sessions' },
      ],
      cta: {
        label: 'Get Started',
        href: 'https://momence.com/m/630919',
        ariaLabel: 'Sign up for unlimited membership',
      },
    },
  ],
};

export default membership;
