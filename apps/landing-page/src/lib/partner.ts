import type { ImageMetadata } from 'astro';

import type { ActionRef, PartnerVerifyCopy } from './types';

// Content shape for a reciprocal-discount partner landing page
// (PartnerLanding.astro). Each partner is one config object: bft.ts,
// humbleHaven.ts. The partner itself must also exist on /admin/partners in
// integrations, keyed by the same `slug`.

export interface PartnerImage {
  src: ImageMetadata;
  alt: string;
  /** CSS object-position focal point for cropped images; defaults to center. */
  position?: string;
}

export interface PartnerStep {
  title: string;
  description: string;
}

export interface PartnerCard {
  title: string;
  body: string;
}

export interface PartnerContent {
  /** Partner slug sent with verification requests; matches /admin/partners. */
  slug: string;
  /** Short partner name for aria labels, e.g. "BFT". */
  name: string;
  discountPercent: number;
  posthogSource: string;
  /** Prefix for CTA `data-track-placement` values, e.g. "bft" -> "bft_hero". */
  trackingPrefix: string;
  eventsUrl: string;
  meta: {
    title: string;
    description: string;
  };
  hero: {
    title: string;
    subtitle: string;
    image: PartnerImage;
    primaryCta: ActionRef;
    secondaryCta: ActionRef;
  };
  verify: {
    pillLabel: string;
    title: string;
    subtitle: string;
    form: PartnerVerifyCopy;
    steps: PartnerStep[];
  };
  recovery: {
    eyebrow: string;
    title: string;
    subtitle: string;
    image: PartnerImage;
    cards: PartnerCard[];
    /** Optional small print under the cards. */
    note?: string;
  };
  intro: {
    pillLabel: string;
    title: string;
    /**
     * Partner-voiced line that follows the generated offer sentence
     * ("Buy 1 credit, get 1 free, and your BFT discount still applies.").
     * Keep offer specifics (counts, prices) out of it; they live in sessions.ts.
     */
    subtitle: string;
    ctaLabel: string;
  };
  packs: {
    title: string;
    subtitle: string;
    withDiscountLabel: string;
    discountReminder: string;
  };
  /** The eyebrow and pitch underneath come from `founding` in membership.ts. */
  membershipSection: {
    title: string;
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
    image: PartnerImage;
  };
  disclaimer: string;
}

/** Price after a partner discount, rounded to the nearest dollar for display. */
export const partnerPrice = (price: number, discountPercent: number): number =>
  Math.round(price * (1 - discountPercent / 100));
