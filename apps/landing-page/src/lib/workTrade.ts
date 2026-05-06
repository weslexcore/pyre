import type { ImageMetadata } from 'astro';

import heroImg from '../assets/images/special_events.webp';

export interface WorkTradeImage {
  src: ImageMetadata;
  alt: string;
}

export interface BackgroundVideo {
  webm: string;
  mp4: string;
  poster: string;
}

export interface WorkTradeStep {
  title: string;
  description: string;
}

export interface WorkTradeCta {
  label: string;
  href: string;
  ariaLabel?: string;
}

export interface WorkTradeContent {
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    image: WorkTradeImage;
    video?: BackgroundVideo;
    primaryCta: WorkTradeCta;
    secondaryCta?: WorkTradeCta;
  };
  program: {
    title: string;
    summary: string;
    creditAmountLabel: string;
    creditDescription: string;
    fineprint: string;
    steps: WorkTradeStep[];
  };
  rules: {
    title: string;
    items: string[];
  };
  events: {
    title: string;
    subtitle: string;
    emptyState: {
      eyebrow: string;
      heading: string;
      body: string;
      successMessage: string;
    };
  };
  contact: {
    title: string;
    body: string;
    email: string;
    cta: WorkTradeCta;
    video?: BackgroundVideo;
  };
}

const workTrade: WorkTradeContent = {
  hero: {
    eyebrow: 'Work trade & volunteering',
    title: 'Volunteer your time. Sauna on us.',
    subtitle:
      'Join a work day with the Pyre crew — gardening, litter pickups, build days — and we\'ll drop a free session credit on your account. One day, one free session.',
    image: { src: heroImg, alt: 'Pyre community gathering' },
    video: {
      webm: '/videos/IMG_4864.3262cda3eeaabddd.720p.webm',
      mp4: '/videos/IMG_4864.3262cda3eeaabddd.720p.mp4',
      poster: '/videos/IMG_4864.3262cda3eeaabddd.poster.jpg',
    },
    primaryCta: {
      label: 'See upcoming days',
      href: '#upcoming',
      ariaLabel: 'See upcoming volunteer events',
    },
    secondaryCta: {
      label: 'How it works',
      href: '#how-it-works',
      ariaLabel: 'Read how the work-trade program works',
    },
  },
  program: {
    title: 'How the program works',
    summary:
      'Pyre is built by the people who use it. For every volunteer day you complete, we drop one free session credit onto your account.',
    creditAmountLabel: '1 free session',
    creditDescription:
      'Each completed day adds one free-session credit to your account. Show up, work the day, and your next session is on us.',
    fineprint:
      'Credits are issued as session credits to the account of the person who volunteers. They cannot be exchanged for cash, and expire in 1 year.',
    steps: [
      {
        title: '1. Sign up for a day',
        description:
          'Pick a volunteer day that fits your schedule. Each day runs roughly 2–3 hours.',
      },
      {
        title: '2. Show up & pitch in',
        description:
          'Meet the crew on-site. We\'ll handle tools, gloves and equipment — you bring the work ethic.',
      },
      {
        title: '3. Get your credit',
        description:
          'Within 48 hours of finishing your day, we drop one free-session credit into your account.',
      },
      {
        title: '4. Book & sweat',
        description:
          'Use your credit on any session. Want to volunteer again? Stack another credit by signing up for the next event.',
      },
    ],
  },
  rules: {
    title: 'A few ground rules',
    items: [
      'Volunteers must be 18 or older.',
      'You must check in with the day lead at the start and end of the event for your day to count.',
      'Credits are issued to the account of the person who signs up to volunteer.',
      'If weather or staffing forces us to cancel, we\'ll reschedule and you keep priority signup.',
    ],
  },
  events: {
    title: 'Upcoming volunteer days',
    subtitle:
      'Each day is a different focus. Pick what sounds fun, sign up, and we\'ll see you there.',
    emptyState: {
      eyebrow: 'Coming soon',
      heading: 'Get notified when the next volunteer day drops',
      body: 'No volunteer days are scheduled right now. Drop your email and we\'ll let you know the moment we open signups for the next one.',
      successMessage: "You're on the list. We'll send the next volunteer day your way.",
    },
  },
  contact: {
    title: 'Have a project in mind?',
    body: 'Running a community cleanup, trail day, or community-build project we should join? We love showing up. Send us the details and we\'ll see if we can help.',
    email: 'hi@pyresauna.com',
    cta: {
      label: 'Email the team',
      href: 'mailto:hi@pyresauna.com?subject=Work%20Trade%20%2F%20Volunteering%20Idea',
      ariaLabel: 'Email Pyre about a volunteering idea',
    },
    video: {
      webm: '/videos/IMG_0276.d1af0d1292e8bb7f.720p.webm',
      mp4: '/videos/IMG_0276.d1af0d1292e8bb7f.720p.mp4',
      poster: '/videos/IMG_0276.d1af0d1292e8bb7f.poster.jpg',
    },
  },
};

export default workTrade;
