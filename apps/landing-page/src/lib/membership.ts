import type { MembershipContent } from './types';

const membership: MembershipContent = {
  title: 'Membership',
  subtitle: 'Choose the plan that fits your practice',
  note: 'Memberships are nontransferrable',
  tiers: [
    {
      id: '4-sessions',
      name: '4 Sessions',
      price: 119,
      period: '/month',
      description: '4 sessions per month',
      features: [
        { text: '4 sauna & cold plunge sessions' },
        { text: 'Access to all open sessions' },
        { text: 'Locker and amenities included' },
        { text: 'Cancel anytime' },
      ],
      cta: {
        label: 'Get Started',
        href: '#',
        ariaLabel: 'Sign up for 4 sessions per month membership',
      },
    },
    {
      id: 'unlimited',
      name: 'Unlimited',
      price: 199,
      period: '/month',
      description: 'Unlimited access for dedicated practitioners',
      popular: true,
      features: [
        { text: 'Unlimited sauna & cold plunge access' },
        { text: '4 guest passes per month', highlighted: true },
        { text: 'Access to all open sessions' },
        { text: 'Free Pyre tote bag', highlighted: true },
        { text: 'Locker and amenities included' },
      ],
      cta: {
        label: 'Get Started',
        href: '#',
        ariaLabel: 'Sign up for unlimited membership',
      },
    },
  ],
};

export default membership;
