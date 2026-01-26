import type { MembershipContent } from './types';

const membership: MembershipContent = {
  title: 'Membership',
  subtitle: 'Choose the plan that fits your practice',
  tiers: [
    {
      id: 'monthly',
      name: 'Monthly',
      price: 149,
      period: '/month',
      description: 'Flexible month-to-month access',
      features: [
        { text: 'Unlimited sauna & cold plunge access' },
        { text: '2 guest passes per month' },
        { text: 'Access to all open sessions' },
        { text: 'Locker and amenities included' },
        { text: 'Cancel anytime' },
      ],
      cta: {
        label: 'Get Started',
        href: '#',
        ariaLabel: 'Sign up for monthly membership',
      },
    },
    {
      id: '3-month',
      name: '3-Month',
      price: 129,
      period: '/month',
      description: 'Commit to your wellness journey',
      popular: true,
      features: [
        { text: 'Unlimited sauna & cold plunge access' },
        { text: '4 guest passes per month', highlighted: true },
        { text: 'Access to all open sessions' },
        { text: 'Priority booking for events' },
        { text: 'Locker and amenities included' },
        { text: '13% savings vs monthly', highlighted: true },
      ],
      cta: {
        label: 'Get Started',
        href: '#',
        ariaLabel: 'Sign up for 3-month membership',
      },
    },
    {
      id: 'annual',
      name: 'Annual',
      price: 99,
      period: '/month',
      description: 'Best value for dedicated practitioners',
      features: [
        { text: 'Unlimited sauna & cold plunge access' },
        { text: '6 guest passes per month', highlighted: true },
        { text: 'Access to all sessions including guided' },
        { text: 'Priority booking for events' },
        { text: 'Exclusive member events' },
        { text: 'Locker and amenities included' },
        { text: '33% savings vs monthly', highlighted: true },
      ],
      cta: {
        label: 'Get Started',
        href: '#',
        ariaLabel: 'Sign up for annual membership',
      },
    },
  ],
};

export default membership;
