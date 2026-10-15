import centeredImg from '../assets/images/centered.webp';
import hero from '../assets/images/humble-haven/hero.webp';
import warmSaunaImg from '../assets/images/warm_sauna.webp';
import type { PartnerContent } from './partner';

// Humble Haven Yoga (Forest Ave, Richmond): boutique studio built on heated
// power vinyasa, plus unheated and adaptive classes. Their students already
// practice in 95-100°F rooms, so the pitch is continuity with the practice
// (stillness, breath, community) rather than BFT's training-recovery angle.

const humbleHaven: PartnerContent = {
  slug: 'humble-haven',
  name: 'Humble Haven',
  discountPercent: 15,
  posthogSource: 'humble-haven',
  trackingPrefix: 'humble_haven',
  eventsUrl: '/events?utm_source=humble-haven&utm_medium=partner&utm_campaign=humble-haven-15',
  meta: {
    title: 'Humble Haven x Pyre | 15% Off Sauna + Cold Plunge',
    description:
      'Humble Haven Yoga members get 15% off Pyre sessions and credit packs. Verify once and the discount applies automatically. Take your practice off the mat and into the heat.',
  },
  hero: {
    title: 'Off the mat. Into the heat.',
    subtitle:
      "Pyre is Richmond's social sauna + cold plunge, now open just south of the river. Humble Haven members get 15% off sessions and credit packs.",
    image: { src: hero, alt: 'A guided sauna session, hands resting over hearts' },
    primaryCta: {
      label: 'Claim your 15% off',
      href: '#offer',
      ariaLabel: 'Claim your 15% off as a Humble Haven Yoga member',
    },
    secondaryCta: {
      label: 'Why heat + cold fit your practice',
      href: '#recovery',
      ariaLabel: 'Learn how sauna and cold plunge fit a yoga practice',
    },
  },
  verify: {
    pillLabel: 'Humble Haven exclusive',
    title: '15% off sauna + cold plunge',
    subtitle: 'Verify your studio membership once and the discount applies automatically.',
    form: {
      firstNameLabel: 'First name',
      firstNamePlaceholder: 'First name',
      lastNameLabel: 'Last name',
      lastNamePlaceholder: 'Last name',
      emailLabel: 'The email you book with at Pyre',
      emailPlaceholder: 'you@example.com',
      emailHelp: 'Your discount attaches to this email. Book with it and 15% comes off.',
      phoneLabel: 'Phone number',
      phonePlaceholder: '(804) 555-0123',
      partnerEmailLabel: 'Email on your Humble Haven account (if different)',
      partnerEmailPlaceholder: 'Optional',
      submitLabel: 'Verify my membership',
      submittingLabel: 'Sending…',
      successMessage:
        "Request sent! We'll email you as soon as Humble Haven confirms your membership, usually within a day or two.",
      errorMessage: 'Something went wrong. Please try again.',
    },
    steps: [
      {
        title: 'Tell us who you are',
        description: 'Your name and booking email. Ten seconds, tops.',
      },
      {
        title: 'Humble Haven confirms',
        description: "One click on the studio's end. We'll email you the moment it lands.",
      },
      {
        title: '15% comes off automatically',
        description: 'Every session and credit pack, at checkout. No code to remember.',
      },
    ],
  },
  recovery: {
    eyebrow: 'Heat, cold, and breath',
    title: 'You already know how to be in the heat.',
    subtitle:
      "Hot power vinyasa teaches you to stay steady when the room is 95 degrees and your heart is pounding. Sauna and cold plunge ask the same thing of you, minus the poses. Here's what that practice looks like off the mat.",
    image: { src: centeredImg, alt: 'Eyes closed, breathing slowly in the cold plunge' },
    cards: [
      {
        title: 'The longest savasana',
        body: 'No flow, no cues, no next pose. Just heat, quiet, and your breath. The stillness your practice keeps pointing you toward, with nowhere else to be.',
      },
      {
        title: 'The plunge is pranayama',
        body: 'Cold water makes your breath want to race. Slowing it down on purpose, one long exhale at a time, is breath control with very fast feedback.',
      },
      {
        title: 'Soften what you opened',
        body: 'Heat brings blood flow to the hips, hamstrings, and shoulders you worked on the mat. Many people find they move more easily the next day.',
      },
      {
        title: 'Come with your community',
        body: 'You come to Humble Haven for the people as much as the practice. Pyre is a social sauna, built for showing up with the friends from the next mat over.',
      },
    ],
    note: 'Coming straight from a heated class? Drink water first and take the heat at your own pace. Same as on the mat, listen to your body.',
  },
  intro: {
    pillLabel: 'New here?',
    title: 'Start with the Intro',
    subtitle: 'Feel how heat and cold fit into your practice.',
    ctaLabel: 'Get the Intro Offer',
  },
  packs: {
    title: 'Sessions + credit packs',
    subtitle:
      'One credit is one session of sauna + cold plunge. Verified Humble Haven members save 15% on all of it.',
    withDiscountLabel: 'with Humble Haven discount',
    discountReminder: "Once you're verified, 15% comes off automatically at checkout.",
  },
  membershipSection: {
    title: 'Make it part of your practice',
    popularPillLabel: 'Most Popular',
  },
  signupCopy: {
    title: 'Not ready to book?',
    subtitle:
      "Drop your email and we'll send Humble Haven member invites to events, plus first word on new offers.",
    successMessage: "You're on the list. See you after your next class.",
  },
  closing: {
    title: 'Your practice, extended.',
    subtitle:
      "We're open now at Living Water. Verify your membership, book a session, and bring the friends from your mat row. 15% off, every time.",
    cta: {
      label: 'Book a session',
      href: '/events?utm_source=humble-haven&utm_medium=partner&utm_campaign=humble-haven-15',
      ariaLabel: 'Book a Pyre session',
    },
    image: { src: warmSaunaImg, alt: '' },
  },
  disclaimer:
    'Offer for verified Humble Haven Yoga members. The 15% discount applies automatically to sessions and credit packs at checkout after verification. Pyre may confirm membership status with Humble Haven Yoga quarterly.',
};

export default humbleHaven;
