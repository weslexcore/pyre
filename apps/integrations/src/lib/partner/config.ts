// Reciprocal-discount partner registry. Adding a partner is additive: one
// entry here, a contact-email env var, and the matching Momence dashboard
// setup (customer tag + tag-keyed price rule). Nothing else is per-partner.

export interface PartnerConfig {
  slug: string;
  /** Display name used in email copy ("BFT Carytown"). */
  name: string;
  /**
   * Who receives confirm/deny requests and the quarterly reconciliation.
   * null = partner not yet configured; verification requests are rejected.
   */
  contactEmail: string | null;
  /** Momence customer tag (case-insensitive) the price rule keys on. */
  tagName: string;
  discountPercent: number;
}

// process.env fallbacks throughout: import.meta.env inlines at build time, so
// env vars added to Vercel after the cached build only exist at runtime.
export const PARTNERS: Record<string, PartnerConfig> = {
  bft: {
    slug: 'bft',
    name: 'BFT Carytown',
    contactEmail:
      import.meta.env.PARTNER_BFT_CONTACT_EMAIL ?? process.env.PARTNER_BFT_CONTACT_EMAIL ?? null,
    tagName: 'partner-bft',
    discountPercent: 15,
  },
};

export function getPartner(slug: string): PartnerConfig | null {
  return PARTNERS[slug] ?? null;
}

/** Pyre staff address CC'd on all partner-facing email (visibility, replies). */
export function getPartnerCcEmail(): string | null {
  return import.meta.env.PARTNER_CC_EMAIL ?? process.env.PARTNER_CC_EMAIL ?? null;
}
