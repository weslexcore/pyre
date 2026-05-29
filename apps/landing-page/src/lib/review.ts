/**
 * Content + config for the /review page.
 *
 * Placeholders to swap before launch:
 *   - urls.google → verified Google Business Profile review URL
 *   - urls.yelp   → Yelp write-a-review URL (or null to hide the CTA)
 */

export const REVIEW_URL_PLACEHOLDER = 'TODO_GOOGLE_REVIEW_URL';

import heroImage from '../assets/images/cold_smile.webp';

export interface ReviewContent {
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    image: ImageMetadata;
    imageAlt: string;
  };
  intro: {
    headline: string;
    body: string;
  };
  prompt: string;
  ratingLabels: Record<1 | 2 | 3 | 4 | 5, string>;
  submitLabel: string;
  changeRatingLabel: string;
  promoter: {
    headline: string;
    body: string;
    googleCta: { label: string; ariaLabel: string };
    yelpCta: { label: string; ariaLabel: string };
    privateFeedbackLink: { label: string; ariaLabel: string };
  };
  feedback: {
    headline: string;
    body: string;
    emailCta: { label: string; ariaLabel: string };
    alsoPublicLink: { label: string; ariaLabel: string };
  };
  urls: {
    google: string;
    yelp: string | null;
  };
  threshold: 5;
  fallbackEmail: string;
}

const review: ReviewContent = {
  hero: {
    eyebrow: 'Thanks for visiting',
    title: 'How was your session?',
    subtitle:
      'A minute of your time goes a long way. Your feedback shapes how we build the space.',
    image: heroImage,
    imageAlt: 'A Pyre guest smiling after a cold plunge',
  },
  intro: {
    headline: 'Tell us what you thought',
    body: 'Rate your visit honestly. If you loved it, share it with the world. If anything fell short, tell us — we read every word.',
  },
  prompt: 'How would you rate your experience?',
  ratingLabels: {
    1: 'Disappointing',
    2: 'Not great',
    3: 'It was fine',
    4: 'Pretty good',
    5: 'Loved it',
  },
  submitLabel: 'Submit rating',
  changeRatingLabel: 'Change rating',
  promoter: {
    headline: 'That made our day.',
    body: 'Would you share it publicly? Google reviews especially help other folks discover Pyre.',
    googleCta: {
      label: 'Review on Google',
      ariaLabel: 'Leave a review on Google (opens in a new tab)',
    },
    yelpCta: {
      label: 'Review on Yelp',
      ariaLabel: 'Leave a review on Yelp (opens in a new tab)',
    },
    privateFeedbackLink: {
      label: 'Or send us private feedback →',
      ariaLabel: 'Send private feedback to Pyre via email',
    },
  },
  feedback: {
    headline: 'Thanks for the honesty.',
    body: 'Tell us what could have been better — we read every message and respond personally.',
    emailCta: {
      label: 'Send feedback',
      ariaLabel: 'Open your email client to send feedback to Pyre',
    },
    alsoPublicLink: {
      label: 'You can also leave a public review →',
      ariaLabel: 'Leave a public review on Google (opens in a new tab)',
    },
  },
  urls: {
    google: "https://www.google.com/search?q=pyre+sauna",
    yelp: "https://www.yelp.com/writeareview/biz/s-pLbR9zcGMauIIMu_yxAw",
  },
  threshold: 5,
  fallbackEmail: 'hi@pyresauna.com',
};

export default review;
