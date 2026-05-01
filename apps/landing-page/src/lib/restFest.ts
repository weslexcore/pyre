import type { ImageMetadata } from 'astro';

import bathhouseTote from '../assets/images/merch/bathhouse-tote/DSCF4135.webp';
import dualityShirt from '../assets/images/merch/duality-shirt/DSCF4130.webp';
import membershipImg from '../assets/images/837A0262.webp';
import sessionImg from '../assets/images/837A0269.webp';

export interface RestFestPrize {
  name: string;
  count: number;
  note?: string;
  image: {
    src: ImageMetadata;
    alt: string;
  };
}

export interface RestFestContent {
  tagId: string;
  posthogSource: string;
  eventsUrl: string;
  signupCopy: {
    title: string;
    subtitle: string;
    successMessage: string;
  };
  prizes: RestFestPrize[];
  disclaimer: string;
}

const restFest: RestFestContent = {
  tagId: '315211',
  posthogSource: 'restfest_2026',
  eventsUrl: '/events?utm_source=restfest2026&utm_medium=event&utm_campaign=rest_fest_2026',
  signupCopy: {
    title: 'Enter the raffle',
    subtitle: "Drop your email to enter and we'll send you pre-opening session invites.",
    successMessage: "You're entered. Good luck — we'll be in touch.",
  },
  prizes: [
    {
      name: 'Founding Unlimited Membership',
      count: 1,
      note: 'Valid for 6 months from Grand Opening',
      image: { src: membershipImg, alt: 'Pyre sauna outdoor showers' },
    },
    {
      name: 'Free Session',
      count: 4,
      note: 'One free session each',
      image: { src: sessionImg, alt: 'Pyre sauna session' },
    },
    {
      name: 'Pyre T-Shirt',
      count: 1,
      image: { src: dualityShirt, alt: 'Pyre Duality Shirt — worn' },
    },
    {
      name: 'Pyre Tote',
      count: 1,
      image: { src: bathhouseTote, alt: 'The Bathhouse Tote by Pyre' },
    },
  ],
  disclaimer:
    "Drawing held the week after Rest Fest. Memberships are valid 6 months from Pyre's Grand Opening (planned Fall 2026) and include access to all soft-open events. No purchase necessary; one entry per person.",
};

export default restFest;
