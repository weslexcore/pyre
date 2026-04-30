import type { MembershipContent } from './types';

const membership: MembershipContent = {
  title: 'Memberships',
  // subtitle: 'Founding Member offer: $199/mo for life (normally $249). Only 30 available.',
  note: 'Pay once today. Monthly billing pauses until Grand Opening (Fall 2026). Memberships are nontransferrable.',
  tiers: [
    // {
    //   id: '4-sessions',
    //   name: 'Limited',
    //   price: 99,
    //   period: '/month',
    //   description: '4 sessions per month',
    //   savings: 57,
    //   features: [
    //     { text: '4 sauna & cold plunge sessions' },
    //     { text: 'Credits rollover 1 month', highlighted: true },
    //     { text: '10% off extra sessions', highlighted: true },
    //   ],
    //   cta: {
    //     label: 'Get Started',
    //     href: 'https://momence.com/m/633377',
    //     ariaLabel: 'Sign up for 4 sessions per month membership',
    //   },
    // },
    {
      id: 'unlimited',
      name: 'Founding Unlimited',
      price: 199,
      period: '/month for life (normally $249)',
      description:
        'Unlimited access for life. Every pre-opening and soft-open session now, plus unlimited monthly access at Grand Opening — locked at the founding rate forever.',
      savings: 50,
      popular: true,
      features: [
        { text: '$199/mo locked in for life — only 30 available', highlighted: true },
        { text: 'Unlimited pre-opening + soft-open sessions', highlighted: true },
        { text: 'First charge today, monthly billing pauses until opening' },
        { text: 'Free Pyre tote bag' },
        { text: '4 guest passes per month at opening ($156 value)' },
        { text: '10% off extra guest sessions' },
      ],
      cta: {
        label: 'Claim Founding Membership',
        href: 'https://momence.com/m/756341',
        ariaLabel: 'Claim Founding Unlimited membership — $199 per month for life',
      },
    },
  ],
};

export default membership;
