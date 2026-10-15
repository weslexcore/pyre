import coldSmileImg from '../assets/images/cold_smile.webp';
import hero from '../assets/images/embody/hero.webp';
import warmSaunaImg from '../assets/images/warm_sauna.webp';
import type { PartnerContent } from './partner';

// Embody Pilates: small-group reformer studio (Scott's Addition) opening a
// Forest Hill studio in January 2027, a few hundred feet from Pyre. The pitch
// is the walk: class, then heat, no second drive. Their "Come as you are"
// inclusivity and pre/postnatal + rehab clientele shape the tone and the
// safety note.

const embody: PartnerContent = {
  slug: 'embody',
  name: 'Embody',
  discountPercent: 15,
  posthogSource: 'embody',
  trackingPrefix: 'embody',
  eventsUrl: '/events?utm_source=embody&utm_medium=partner&utm_campaign=embody-15',
  meta: {
    title: 'Embody Pilates x Pyre | 15% Off Sauna + Cold Plunge',
    description:
      "Embody Pilates members get 15% off Pyre sessions and credit packs. Verify once and the discount applies automatically. Embody's Forest Hill studio is a short walk from our door.",
  },
  hero: {
    title: "Come as you are.\nWe'll meet you down the street.",
    subtitle:
      "Embody's new Forest Hill studio is a few hundred feet from Pyre, Richmond's social sauna + cold plunge. Embody members get 15% off sessions and credit packs.",
    image: {
      src: hero,
      alt: 'Two instructors holding a lunge on the reformers at Embody Pilates',
    },
    primaryCta: {
      label: 'Claim your 15% off',
      href: '#offer',
      ariaLabel: 'Claim your 15% off as an Embody Pilates member',
    },
    secondaryCta: {
      label: 'Why heat + cold after Pilates',
      href: '#recovery',
      ariaLabel: 'Learn why sauna and cold plunge pair well with Pilates',
    },
  },
  verify: {
    pillLabel: 'Embody Pilates exclusive',
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
      partnerEmailLabel: 'Email on your Embody account (if different)',
      partnerEmailPlaceholder: 'Optional',
      submitLabel: 'Verify my membership',
      submittingLabel: 'Sending…',
      successMessage:
        "Request sent! We'll email you as soon as Embody confirms your membership, usually within a day or two.",
      errorMessage: 'Something went wrong. Please try again.',
    },
    steps: [
      {
        title: 'Tell us who you are',
        description: 'Your name and booking email. Ten seconds, tops.',
      },
      {
        title: 'Embody confirms',
        description: "One click on the studio's end. We'll email you the moment it lands.",
      },
      {
        title: '15% comes off automatically',
        description: 'Every session and credit pack, at checkout. No code to remember.',
      },
    ],
  },
  recovery: {
    eyebrow: 'After the reformer',
    title: 'Fifty minutes of control. Now let go.',
    subtitle:
      "Pilates asks for precision: slow springs, steady breath, small muscles you didn't know you had. Sauna and cold plunge ask for nothing at all. Here's why the two belong together, a short walk apart.",
    image: { src: coldSmileImg, alt: 'Smiling in the cold plunge' },
    cards: [
      {
        title: 'Walk over, warm up',
        body: "Class ends, you grab your bag, and you're at the sauna a couple of minutes later. No second drive, no second parking spot, no talking yourself out of it.",
      },
      {
        title: 'Let the deep muscles soften',
        body: 'Reformer work lights up your core, glutes, and the small stabilizers around your hips and spine. Heat brings blood flow to all of it, and many people find they move more easily the next day.',
      },
      {
        title: 'Breath, both ways',
        body: 'Pilates teaches you to breathe with intention through every exercise. In the cold plunge, that same steady exhale is what turns a gasp into calm.',
      },
      {
        title: 'Built for every body',
        body: "Embody believes Pilates is for every body. We feel the same way about heat and cold: every age, shape, and starting point is welcome, and nobody's keeping score.",
      },
    ],
    note: 'Pregnant, postpartum, or working through an injury? Check with your provider before using the sauna or cold plunge, and take it at your own pace.',
  },
  intro: {
    pillLabel: 'New here?',
    title: 'Start with the Intro',
    subtitle: 'Try it after your next class.',
    ctaLabel: 'Get the Intro Offer',
  },
  packs: {
    title: 'Sessions + credit packs',
    subtitle:
      'One credit is one session of sauna + cold plunge. Verified Embody members save 15% on all of it.',
    withDiscountLabel: 'with Embody discount',
    discountReminder: "Once you're verified, 15% comes off automatically at checkout.",
  },
  membershipSection: {
    title: 'Pair it with your weekly classes',
    popularPillLabel: 'Most Popular',
  },
  signupCopy: {
    title: 'Not ready to book?',
    subtitle:
      "Drop your email and we'll send Embody member invites to events, plus first word on new offers.",
    successMessage: "You're on the list. See you after class, neighbor.",
  },
  closing: {
    title: 'See you down the street.',
    subtitle:
      "We're open now at Living Water, a short walk from Embody's Forest Hill studio. Verify your membership, book a session, and bring a friend from class. 15% off, every time.",
    cta: {
      label: 'Book a session',
      href: '/events?utm_source=embody&utm_medium=partner&utm_campaign=embody-15',
      ariaLabel: 'Book a Pyre session',
    },
    image: { src: warmSaunaImg, alt: '' },
  },
  disclaimer:
    'Offer for verified Embody Pilates members. The 15% discount applies automatically to sessions and credit packs at checkout after verification. Pyre may confirm membership status with Embody Pilates quarterly.',
};

export default embody;
