// Copy for the referral landing page (/r/{code}) and its redemption form.
// The referrer's name and discount percent are interpolated at render time —
// {name} and {discount} placeholders in the strings below.

export interface ReferralFormCopy {
  firstNameLabel: string;
  firstNamePlaceholder: string;
  lastNameLabel: string;
  lastNamePlaceholder: string;
  emailLabel: string;
  emailPlaceholder: string;
  emailHelp: string;
  submitLabel: string;
  submittingLabel: string;
  successTitle: string;
  successMessage: string;
  errorMessage: string;
  /** Keyed on the relay's result codes for policy rejections. */
  rejections: {
    'already-redeemed': string;
    'existing-customer': string;
    'self-referral': string;
    'referrer-disabled': string;
    'unknown-code': string;
  };
}

export interface ReferralStep {
  title: string;
  description: string;
}

export interface ReferralPageContent {
  posthogSource: string;
  hero: {
    /** {name} and {discount} interpolated. */
    title: string;
    subtitle: string;
  };
  claim: {
    pillLabel: string;
    title: string;
    subtitle: string;
  };
  steps: ReferralStep[];
  form: ReferralFormCopy;
  disclaimer: string;
}

export function interpolate(
  template: string,
  values: { name?: string; discount?: string }
): string {
  return template
    .split('{name}')
    .join(values.name ?? '')
    .split('{discount}')
    .join(values.discount ?? '');
}

const referral: ReferralPageContent = {
  posthogSource: 'referral',
  hero: {
    title: '{name} gave you {discount} off',
    subtitle:
      "Pyre is Richmond's social sauna + cold plunge. Claim your discount and get {discount} off your first session — no code needed at checkout.",
  },
  claim: {
    pillLabel: 'A gift from {name}',
    title: 'Claim your {discount} off',
    subtitle: 'First time at Pyre? Tell us where to put the discount and it applies automatically.',
  },
  steps: [
    {
      title: 'Tell us who you are',
      description: 'Your name and the email you’ll book with. Takes 10 seconds.',
    },
    {
      title: 'The discount attaches to your account',
      description: 'Instantly — we’ll email you a booking link the moment it’s live.',
    },
    {
      title: '{discount} comes off automatically',
      description: 'On your first session, at checkout. No code needed.',
    },
  ],
  form: {
    firstNameLabel: 'First name',
    firstNamePlaceholder: 'First name',
    lastNameLabel: 'Last name',
    lastNamePlaceholder: 'Last name',
    emailLabel: 'The email you’ll book with',
    emailPlaceholder: 'you@example.com',
    emailHelp: 'Your discount attaches to this email — book with it and {discount} comes off.',
    submitLabel: 'Claim my discount',
    submittingLabel: 'Claiming…',
    successTitle: 'You’re in!',
    successMessage:
      'Your discount is live. Check your inbox for a booking link — or book right away and {discount} comes off at checkout.',
    errorMessage: 'Something went wrong. Please try again.',
    rejections: {
      'already-redeemed':
        'Looks like you’ve already claimed a referral discount — check your inbox for your booking link.',
      'existing-customer':
        'Referral discounts are for first-time guests, and it looks like you’ve been to Pyre before. We love that! Check your account for member perks instead.',
      'self-referral':
        'Nice try — you can’t refer yourself. Share your link with a friend instead!',
      'referrer-disabled': 'This referral link is no longer active.',
      'unknown-code': 'This referral link looks broken — ask your friend to re-send it.',
    },
  },
  disclaimer:
    'Referral discount valid for first-time Pyre guests on their first session booking. One referral discount per person. Applied automatically at checkout when you book with the email you claimed with.',
};

export default referral;
