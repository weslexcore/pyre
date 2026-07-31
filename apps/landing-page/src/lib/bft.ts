import type { ImageMetadata } from 'astro';

import bftKettlebellsImg from '../assets/images/bft/bft-kettlebells.png';
import bftTrainingImg from '../assets/images/bft/bft-training.png';
import warmSaunaImg from '../assets/images/warm_sauna.webp';
import type { ActionRef, PartnerVerifyCopy } from './types';

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
  verify: {
    pillLabel: string;
    title: string;
    subtitle: string;
    form: PartnerVerifyCopy;
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
    withDiscountLabel: string;
    discountReminder: string;
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
  verify: {
    pillLabel: 'BFT Carytown exclusive',
    title: '15% off sauna + cold plunge',
    subtitle: 'Verify your membership to receive your discount automatically.',
    form: {
      firstNameLabel: 'First name',
      firstNamePlaceholder: 'First name',
      lastNameLabel: 'Last name',
      lastNamePlaceholder: 'Last name',
      emailLabel: 'The email you book with at Pyre',
      emailPlaceholder: 'you@example.com',
      emailHelp: 'Your discount attaches to this email — book with it and 15% comes off.',
      phoneLabel: 'Phone number',
      phonePlaceholder: '(804) 555-0123',
      partnerEmailLabel: 'Email on your BFT account (if different)',
      partnerEmailPlaceholder: 'Optional',
      submitLabel: 'Verify my membership',
      submittingLabel: 'Sending…',
      successMessage:
        "Request sent! We'll email you as soon as BFT Carytown confirms your membership — usually within a day or two.",
      errorMessage: 'Something went wrong. Please try again.',
    },
    steps: [
      {
        title: 'Tell us who you are',
        description: 'Your name and booking email. Takes 10 seconds.',
      },
      {
        title: 'BFT confirms your membership',
        description: "One click on their end. We'll email you the moment it lands.",
      },
      {
        title: '15% comes off automatically',
        description: 'Every session and credit pack, at checkout. No code needed.',
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
      'Buy 1 credit, get 1 free — and your BFT discount still applies. Two sessions to see how the heat and cold treat you.',
    ctaLabel: 'Get the Intro Offer',
  },
  packs: {
    title: 'Sessions + credit packs',
    subtitle:
      'One credit is one session of sauna + cold plunge. Verified BFT members save 15% on all of it.',
    withDiscountLabel: 'with BFT discount',
    discountReminder: "Once you're verified, 15% comes off automatically at checkout.",
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
      "We're open now at Living Water. Verify your membership, book a session, and bring your BFT crew — 15% off, every time.",
    cta: {
      label: 'Book a session',
      href: '/events?utm_source=bft&utm_medium=partner&utm_campaign=bft-15',
      ariaLabel: 'Book a Pyre session',
    },
    image: { src: warmSaunaImg, alt: '' },
  },
  disclaimer:
    'Offer for verified BFT Carytown members. The 15% discount applies automatically to sessions and credit packs at checkout after verification. Pyre may confirm membership status with BFT Carytown quarterly.',
};

export default bft;
