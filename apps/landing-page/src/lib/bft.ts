import type { ImageMetadata } from 'astro';

import bftKettlebellsImg from '../assets/images/bft/bft-kettlebells.png';
import bftTrainingImg from '../assets/images/bft/bft-training.png';
import warmSaunaImg from '../assets/images/warm_sauna.webp';
import type { ActionRef } from './types';

export interface BftImage {
  src: ImageMetadata;
  alt: string;
}

export interface BftStep {
  title: string;
  description: string;
}

export interface BftRecoveryCard {
  title: string;
  body: string;
}

export interface BftContent {
  promoCode: string;
  discountPercent: number;
  posthogSource: string;
  eventsUrl: string;
  hero: {
    title: string;
    subtitle: string;
    image: BftImage;
    primaryCta: ActionRef;
    secondaryCta: ActionRef;
  };
  offer: {
    pillLabel: string;
    title: string;
    subtitle: string;
    copyLabel: string;
    copiedLabel: string;
    steps: BftStep[];
  };
  recovery: {
    eyebrow: string;
    title: string;
    subtitle: string;
    image: BftImage;
    cards: BftRecoveryCard[];
  };
  intro: {
    pillLabel: string;
    title: string;
    subtitle: string;
    ctaLabel: string;
  };
  packs: {
    title: string;
    subtitle: string;
    withCodeLabel: string;
    codeReminder: string;
  };
  membershipSection: {
    eyebrow: string;
    title: string;
    subtitle: string;
    popularPillLabel: string;
  };
  signupCopy: {
    title: string;
    subtitle: string;
    successMessage: string;
  };
  closing: {
    title: string;
    subtitle: string;
    cta: ActionRef;
    image: BftImage;
  };
  disclaimer: string;
}

/** Price after the BFT member discount, rounded to the nearest dollar for display. */
export const bftPrice = (price: number): number => Math.round(price * 0.85);

const bft: BftContent = {
  promoCode: 'BFT15',
  discountPercent: 15,
  posthogSource: 'bft',
  eventsUrl: '/events?utm_source=bft&utm_medium=partner&utm_campaign=bft-15',
  hero: {
    title: 'Train hard. Recover at Pyre.',
    subtitle:
      "Pyre is Richmond's social sauna + cold plunge, now open just across the river from Carytown. BFT members get 15% off sessions and credit packs.",
    image: { src: bftKettlebellsImg, alt: 'Group kettlebell training at BFT' },
    primaryCta: {
      label: 'Claim your 15% off',
      href: '#offer',
      ariaLabel: 'Claim your 15% off as a BFT Carytown member',
    },
    secondaryCta: {
      label: 'Why sauna after strength training',
      href: '#recovery',
      ariaLabel: 'Learn why sauna and cold plunge help recovery after strength training',
    },
  },
  offer: {
    pillLabel: 'BFT Carytown exclusive',
    title: '15% off sauna + cold plunge',
    subtitle: 'Three steps between you and a proper cooldown.',
    copyLabel: 'Copy code',
    copiedLabel: 'Copied!',
    steps: [
      {
        title: 'Copy code BFT15',
        description: "It's yours because you train at BFT Carytown.",
      },
      {
        title: 'Pick a credit pack or book a session',
        description:
          'Credits work for any session. Every pack except the Intro is shareable with friends & family.',
      },
      {
        title: 'Enter the code at checkout',
        description: "15% comes off. That's it.",
      },
    ],
  },
  recovery: {
    eyebrow: 'The science of the cooldown',
    title: "So you've nailed your workout, but are you recovering enough?",
    subtitle:
      "BFT is built on training intensity backed by data. Recovery is the other half of the equation. Here's what heat and cold do after 50 minutes of strength work.",
    image: { src: bftTrainingImg, alt: 'Coached strength training session at Body Fit Training' },
    cards: [
      {
        title: 'Ease the soreness',
        body: 'Sauna heat drives blood flow to the muscles you just worked, helping clear the byproducts of hard training and taking the edge off next-day soreness.',
      },
      {
        title: 'Heat is a stimulus too',
        body: 'A sauna session raises your heart rate like moderate cardio and triggers heat-shock adaptations. Your body keeps adapting after you rack the weights.',
      },
      {
        title: 'Cold to downshift',
        body: "The plunge flips your nervous system from go-mode to recovery-mode. Walk out calm, clear, and ready for tomorrow's session.",
      },
      {
        title: 'Recover with your people',
        body: 'You train like a family at BFT. Pyre is a social sauna, built for showing up with your crew, not scrolling in a corner.',
      },
    ],
  },
  intro: {
    pillLabel: 'New here?',
    title: 'Start with the Intro',
    subtitle:
      'Buy 1 credit, get 1 free, and code BFT15 still applies. Two sessions to see how the heat and cold treat you.',
    ctaLabel: 'Get the Intro Offer',
  },
  packs: {
    title: 'Sessions + credit packs',
    subtitle:
      'One credit is one session of sauna + cold plunge. Code BFT15 takes 15% off all of it.',
    withCodeLabel: 'with BFT15',
    codeReminder: 'Enter code BFT15 at checkout to get your discount.',
  },
  membershipSection: {
    eyebrow: 'Founding Memberships',
    title: 'Want to make it a part of your routine?',
    subtitle:
      'Founding rates are locked in for life, and only 30 of each exist. Go unlimited or keep a steady rhythm of 8 credits a month.',
    popularPillLabel: 'Most Popular',
  },
  signupCopy: {
    title: 'Not ready to book?',
    subtitle:
      "Drop your email and we'll send BFT-member invites to events, plus first word on new offers.",
    successMessage: "You're on the list. See you after your next workout.",
  },
  closing: {
    title: 'Train hard. Recover at Pyre.',
    subtitle:
      "We're open now at Living Water. Book a session, bring your BFT crew, and let code BFT15 take 15% off.",
    cta: {
      label: 'Book a session',
      href: '/events?utm_source=bft&utm_medium=partner&utm_campaign=bft-15',
      ariaLabel: 'Book a Pyre session',
    },
    image: { src: warmSaunaImg, alt: '' },
  },
  disclaimer:
    'Offer for BFT Carytown members. Enter code BFT15 at checkout for 15% off sessions and credit packs.',
};

export default bft;
