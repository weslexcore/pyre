import type { ImageMetadata } from 'astro';

import communityImg1 from '../assets/images/community_1.webp';
import communityImg2 from '../assets/images/community_2.webp';
import communityImg3 from '../assets/images/community_3.webp';
import heroImg from '../assets/images/special_events.webp';
import treesImg from '../assets/images/trees.webp';
import flowersImg from '../assets/images/red_flowers_in_hand.webp';

export interface WorkTradeImage {
  src: ImageMetadata;
  alt: string;
}

export interface WorkTradeStep {
  title: string;
  description: string;
}

export interface VolunteerEvent {
  id: string;
  title: string;
  date: string;
  time?: string;
  location: string;
  description: string;
  activity: string;
  image: WorkTradeImage;
  signupUrl?: string;
  spotsRemaining?: number;
  isPast?: boolean;
}

export interface WorkTradeContent {
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    image: WorkTradeImage;
    primaryCta: { label: string; href: string; ariaLabel?: string };
    secondaryCta?: { label: string; href: string; ariaLabel?: string };
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
    items: VolunteerEvent[];
    emptyState: string;
  };
  contact: {
    title: string;
    body: string;
    email: string;
    cta: { label: string; href: string; ariaLabel?: string };
  };
}

const workTrade: WorkTradeContent = {
  hero: {
    eyebrow: 'Work trade & volunteering',
    title: 'Volunteer your time. Sauna on us.',
    subtitle:
      'Join a sign-up day with the Pyre crew — gardening, litter pickups, build days — and we\'ll drop a free session credit on your account. One day, one free session.',
    image: { src: heroImg, alt: 'Pyre community gathering' },
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
      'Pyre is built by the people who use it. For every volunteer day you complete with us, we drop one free session credit onto your booking account — the same one you use to reserve sessions.',
    creditAmountLabel: '1 free session',
    creditDescription:
      'Each completed day adds one free-session credit to the volunteer\'s booking account. Show up, work the day, and your next session is on us.',
    fineprint:
      'Credits are issued as session credits to the account of the person who showed up. They are non-transferable and cannot be exchanged for cash, but do not expire while we are pre-opening.',
    steps: [
      {
        title: '1. Sign up for a day',
        description:
          'Pick a volunteer day below that fits your schedule. Each day runs roughly 2–3 hours.',
      },
      {
        title: '2. Show up & pitch in',
        description:
          'Meet the crew on-site. We\'ll handle tools, gloves, water, and snacks — you bring the work ethic.',
      },
      {
        title: '3. Get your credit',
        description:
          'Within 48 hours of finishing your day, we drop one free-session credit onto the booking account of the person who volunteered.',
      },
      {
        title: '4. Book & sweat',
        description:
          'Use your credit on any standard session. Want to volunteer again? Stack another credit by signing up for the next day.',
      },
    ],
  },
  rules: {
    title: 'A few ground rules',
    items: [
      'Volunteers must be 18 or older. No exceptions — we\'re working with tools, heat, and uneven terrain.',
      'You must check in with the day lead at the start and end of the event for your day to count.',
      'Credits are issued only to the account of the person who actually shows up — no transferring, no proxies.',
      'Credits are tracked under the email you use to book; let us know in advance if it differs from your signup email.',
      'If weather or staffing forces us to cancel, we\'ll reschedule and you keep priority signup.',
    ],
  },
  events: {
    title: 'Upcoming volunteer days',
    subtitle:
      'Each day is a different focus. Pick what sounds fun, sign up, and we\'ll see you there.',
    items: [
      {
        id: 'garden-may-2026',
        title: 'Garden Day at Living Water',
        date: 'Saturday, May 16, 2026',
        time: '9:00 AM – 12:00 PM',
        location: 'Living Water · Richmond, VA',
        activity: 'Gardening',
        description:
          'Help us put native pollinator beds in around the cold-plunge patio. Expect digging, mulching, and planting. Tools and gloves provided.',
        image: { src: flowersImg, alt: 'Hands holding red flowers' },
        signupUrl: 'mailto:hi@pyresauna.com?subject=Volunteer%20Sign-Up%20-%20Garden%20Day%20May%2016',
        spotsRemaining: 8,
      },
      {
        id: 'litter-cleanup-may-2026',
        title: 'James River Litter Cleanup',
        date: 'Sunday, May 24, 2026',
        time: '10:00 AM – 12:00 PM',
        location: 'Pony Pasture · Richmond, VA',
        activity: 'Litter cleanup',
        description:
          'Trash bags, grabbers, and good company. We\'ll sweep the riverbank with our friends at the James River Park System and end with a picnic.',
        image: { src: treesImg, alt: 'Trees along the James River' },
        signupUrl: 'mailto:hi@pyresauna.com?subject=Volunteer%20Sign-Up%20-%20Litter%20Cleanup%20May%2024',
        spotsRemaining: 12,
      },
      {
        id: 'build-day-june-2026',
        title: 'Build Day: Sauna Deck',
        date: 'Saturday, June 6, 2026',
        time: '9:00 AM – 1:00 PM',
        location: 'Pyre · Richmond, VA',
        activity: 'Build & finishing',
        description:
          'Sand, stain, and seal the cedar decking around the new sauna. Some experience helpful but not required — we\'ll teach you what you need.',
        image: { src: communityImg1, alt: 'Pyre community working together' },
        signupUrl: 'mailto:hi@pyresauna.com?subject=Volunteer%20Sign-Up%20-%20Build%20Day%20June%206',
        spotsRemaining: 6,
      },
      {
        id: 'community-sweat-june-2026',
        title: 'Community Trail Day',
        date: 'Saturday, June 20, 2026',
        time: '8:30 AM – 11:30 AM',
        location: 'Forest Hill Park · Richmond, VA',
        activity: 'Trail maintenance',
        description:
          'Partner day with the Richmond MTB community. Brush clearing, drainage, and a shared sauna session afterward (separate signup).',
        image: { src: communityImg2, alt: 'Pyre community outdoors' },
        signupUrl: 'mailto:hi@pyresauna.com?subject=Volunteer%20Sign-Up%20-%20Trail%20Day%20June%2020',
        spotsRemaining: 10,
      },
      {
        id: 'paint-day-july-2026',
        title: 'Paint & Polish Day',
        date: 'Saturday, July 11, 2026',
        time: '10:00 AM – 1:00 PM',
        location: 'Pyre · Richmond, VA',
        activity: 'Painting & detailing',
        description:
          'Touch-up paint, signage install, and details that make the space feel finished. Bring a friend — this one is great for first-timers.',
        image: { src: communityImg3, alt: 'Pyre community gathering' },
        signupUrl: 'mailto:hi@pyresauna.com?subject=Volunteer%20Sign-Up%20-%20Paint%20Day%20July%2011',
        spotsRemaining: 14,
      },
    ],
    emptyState:
      'No volunteer days are scheduled right now. Email hi@pyresauna.com to be the first to know when the next one drops.',
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
  },
};

export default workTrade;
