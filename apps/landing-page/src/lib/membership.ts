import type { MembershipContent } from './types';

const membership: MembershipContent = {
  title: 'Memberships',
  // subtitle: 'Founding Member offer: $199/mo for life (normally $249). Only 30 available.',
  note: 'Founding rates are locked in for life. Membership is not shareable.',
  tiers: [
    {
      id: 'unlimited',
      name: 'Founding Unlimited',
      price: 199,
      period: '/month for life (normally $249)',
      description:
        'Unlimited access, locked at the founding rate for life. The deepest way to make Pyre part of your routine.',
      savings: 50,
      popular: true,
      features: [
        { text: 'Unlimited access — $199/mo for life', highlighted: true },
        { text: 'Free bathhouse tote' },
        { text: '4 guest passes per month' },
        { text: '10% off drinks + merch' },
        { text: 'Only 30 available', highlighted: true },
      ],
      cta: {
        label: 'Claim Founding Membership',
        href: 'https://momence.com/m/756341',
        ariaLabel: 'Claim Founding Unlimited membership — $199 per month for life',
      },
    },
    {
      id: 'founding-limited',
      name: 'Founding Limited',
      price: 119,
      period: '/month (normally $200)',
      description:
        '8 credits every month at the founding rate for life. A steady rhythm without the unlimited commitment.',
      savings: 81,
      features: [
        { text: '8 credits per month', highlighted: true },
        { text: '1 guest pass per month' },
        { text: '5% off drinks + merch' },
        { text: 'Only 30 available', highlighted: true },
      ],
      cta: {
        label: 'Claim Founding Membership',
        href: 'https://momence.com/m/633377',
        ariaLabel: 'Claim Founding Limited membership — $119 per month',
      },
    },
  ],
};

export default membership;
