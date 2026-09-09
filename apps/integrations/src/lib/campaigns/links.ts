// Pure link building, shared by the API (the only place links are stored)
// and the form's live previews. No I/O.

import type { Placement } from './placements';
import { slugifyCampaign, slugifyPart } from './slug';
import type { DestinationKind } from './types';

export type ResolvedDestination = { ok: true; url: string } | { ok: false; error: string };

/**
 * Parses a free-text destination into an http(s) URL, or null when it isn't
 * one (yet). A missing scheme is assumed to be https for convenience.
 */
export function parseExternalUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // Reject hostnames without a dot ("https://foo") — almost certainly mid-typing.
  if (!url.hostname.includes('.')) return null;
  return url;
}

/** The absolute URL (no UTM params) a destination choice points at. */
export function resolveDestination(
  origin: string,
  kind: DestinationKind,
  value: string
): ResolvedDestination {
  const trimmed = value.trim();
  switch (kind) {
    case 'home':
      return { ok: true, url: new URL('/', origin).toString() };
    case 'events':
      return { ok: true, url: new URL('/events', origin).toString() };
    case 'linktree':
      // The link-in-bio page.
      return { ok: true, url: new URL('/hi', origin).toString() };
    case 'event': {
      if (!trimmed) return { ok: false, error: 'Pick an event' };
      // The event's own page (not the modal on /events): it carries the
      // event's image for link previews and survives the list changing.
      return {
        ok: true,
        url: new URL(`/events/${encodeURIComponent(trimmed)}`, origin).toString(),
      };
    }
    case 'blog': {
      if (!trimmed) return { ok: false, error: 'Pick a blog post' };
      return { ok: true, url: new URL(`/blog/${encodeURIComponent(trimmed)}`, origin).toString() };
    }
    case 'partner': {
      if (!trimmed) return { ok: false, error: 'Pick a partner' };
      // Partner pages live at /<partner slug> (bft.astro is /bft).
      return { ok: true, url: new URL(`/${encodeURIComponent(trimmed)}`, origin).toString() };
    }
    case 'custom': {
      const parsed = parseExternalUrl(trimmed);
      if (!parsed)
        return { ok: false, error: 'Enter a full web address, like https://example.com/page' };
      return { ok: true, url: parsed.toString() };
    }
    default:
      return { ok: false, error: 'Choose where the links should go' };
  }
}

export interface UtmParams {
  source: string;
  medium: string;
  campaign: string;
  content: string;
  term?: string;
}

/**
 * Appends the non-empty UTM fields to a URL. Uses the URL API so params merge
 * cleanly with any existing query string (e.g. the `?event=<id>` deep-link or
 * an Eventbrite `?aff=` param). utm_campaign is always the slug: attribution
 * reports join PostHog utm_campaign values against the stored slug.
 */
export function applyUtm(url: URL, utm: UtmParams): string {
  const params: Array<[string, string]> = [
    ['utm_source', utm.source],
    ['utm_medium', utm.medium],
    ['utm_campaign', slugifyCampaign(utm.campaign)],
    ['utm_term', utm.term ?? ''],
    ['utm_content', utm.content],
  ];
  for (const [key, value] of params) {
    const trimmed = value.trim();
    if (trimmed) url.searchParams.set(key, trimmed);
  }
  return url.toString();
}

export interface CustomUtm {
  source: string;
  medium: string;
  content: string;
  term: string;
}

export interface BuildLinkArgs {
  /** Resolved destination URL (no UTMs). */
  destinationUrl: string;
  /** The campaign slug (utm_campaign). */
  slug: string;
  placement: Placement;
  /** Variant suffix for utm_content; '' for the plain placement. */
  variant: string;
  /** For placements with askSource: the raw name that becomes utm_source. */
  sourceOverride?: string;
  /** For the custom placement: the free-text values. */
  custom?: CustomUtm;
}

export interface BuiltLink {
  url: string;
  source: string;
  medium: string;
  content: string;
  term: string;
}

/** The utm values a placement produces, before the URL is assembled. */
export function placementUtm(
  placement: Placement,
  variant: string,
  sourceOverride?: string,
  custom?: CustomUtm
): Omit<BuiltLink, 'url'> {
  const variantSlug = slugifyPart(variant);
  if (placement.custom) {
    const content = slugifyPart(custom?.content ?? '');
    return {
      source: slugifyPart(custom?.source ?? ''),
      medium: slugifyPart(custom?.medium ?? ''),
      content: variantSlug ? (content ? `${content}-${variantSlug}` : variantSlug) : content,
      term: slugifyPart(custom?.term ?? ''),
    };
  }
  return {
    source: placement.askSource ? slugifyPart(sourceOverride ?? '') : placement.source,
    medium: placement.medium,
    content: variantSlug ? `${placement.content}-${variantSlug}` : placement.content,
    term: '',
  };
}

export function buildPlacementLink(args: BuildLinkArgs): BuiltLink {
  const utm = placementUtm(args.placement, args.variant, args.sourceOverride, args.custom);
  const url = applyUtm(new URL(args.destinationUrl), { ...utm, campaign: args.slug });
  return { url, ...utm };
}

// Build a readable download filename, always led by the campaign slug, with
// the remaining parts (placement, variant) appended to keep sibling files
// distinct.
export function qrFilename(parts: Array<string | undefined>): string {
  const slug = parts
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `pyre-qr-${slug}` : 'pyre-qr';
}
