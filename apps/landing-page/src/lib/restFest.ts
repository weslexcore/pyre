export interface RestFestPrize {
  name: string;
  count: number;
  note?: string;
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
    title: 'JOIN THE LIST',
    subtitle:
      'Sign up to enter the raffle and hear about pre-opening sessions, soft-open events, and Grand Opening.',
    successMessage: "You're in. We'll be in touch.",
  },
  prizes: [
    { name: 'Founding Unlimited Membership', count: 1, note: 'Valid for 6 months from Grand Opening' },
    // { name: 'Limited Membership', count: 2, note: 'Valid 6 months from Grand Opening' },
    { name: 'Pyre T-Shirt', count: 1 },
    { name: 'Pyre Tote', count: 1 },
  ],
  disclaimer:
    "Drawing held the week after Rest Fest. Memberships are valid 6 months from Pyre's Grand Opening (planned Fall 2026) and include access to all soft-open events. No purchase necessary; one entry per person.",
};

export default restFest;
