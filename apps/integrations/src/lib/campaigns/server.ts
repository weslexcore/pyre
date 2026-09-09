// Server-side helpers for the campaign routes: attaching short-link clicks to
// link records, finding short links the old free-form tool minted for a
// campaign, and the landing-site origin every link is built against.
// Imports the Redis-backed store, so never import this from an island.

import {
  getShortLinks,
  listShortLinks,
  type ShortLink,
  type UtmCampaign,
  type UtmLink,
  updateLink,
  utmCampaignOfUrl,
} from '@pyre/webhook-core';
import type { LinkRow, OrphanShortlink } from './types';

// The public /s/<code> redirect lives on the landing site, so short URLs are
// minted against that origin, not this app's.
export const LANDING_ORIGIN = import.meta.env.PUBLIC_SITE_URL ?? 'https://pyresauna.com';

export function shortUrlFor(code: string): string {
  return `${LANDING_ORIGIN}/s/${code}`;
}

// Short links carry no campaign id. The ones this tool mints are joined by
// the code stored on the link; older ones only by the utm_campaign baked
// into their URL. The join covers the newest 500, same as the report.
const LEGACY_SCAN_LIMIT = 500;

export interface ShortLinkIndex {
  byCode: Map<string, ShortLink>;
  /** Legacy short links grouped by the campaign slug in their URL. */
  bySlug: Map<string, ShortLink[]>;
}

/**
 * Every short link the campaigns can reference: the explicit codes on their
 * links, plus a slug index over recent short links for legacy joins.
 */
export async function loadShortLinkIndex(links: UtmLink[]): Promise<ShortLinkIndex> {
  const codes = links.map((l) => l.shortCode).filter(Boolean);
  const [byCode, page] = await Promise.all([
    getShortLinks(codes),
    listShortLinks(LEGACY_SCAN_LIMIT, 0),
  ]);
  const bySlug = new Map<string, ShortLink[]>();
  for (const link of page.links) {
    const slug = utmCampaignOfUrl(link.url);
    if (!slug) continue;
    const list = bySlug.get(slug) ?? [];
    list.push({ ...link, clicks: Number(link.clicks) || 0 });
    bySlug.set(slug, list);
  }
  return { byCode, bySlug };
}

/**
 * Link records with their short link attached. A legacy link (no shortCode)
 * whose exact URL matches a short link minted under the same campaign gets
 * that code written back, so the join is explicit from then on.
 */
export async function toLinkRows(
  campaign: UtmCampaign,
  links: UtmLink[],
  index: ShortLinkIndex
): Promise<LinkRow[]> {
  const candidates = index.bySlug.get(campaign.slug.toLowerCase()) ?? [];
  const rows: LinkRow[] = [];
  for (const link of links) {
    let code = link.shortCode;
    let short = code ? index.byCode.get(code) : undefined;
    if (!short) {
      const match = candidates.find((s) => s.url === link.url);
      if (match) {
        short = match;
        code = match.code;
        await updateLink(link.id, { shortCode: code });
      }
    }
    rows.push({
      ...link,
      shortCode: short ? code : '',
      shortUrl: short ? shortUrlFor(short.code) : null,
      clicks: short ? Number(short.clicks) || 0 : 0,
    });
  }
  return rows;
}

/** Short links carrying this campaign's slug that no link record claims. */
export function orphanShortlinks(
  campaign: UtmCampaign,
  rows: LinkRow[],
  index: ShortLinkIndex
): OrphanShortlink[] {
  const claimed = new Set(rows.map((r) => r.shortCode).filter(Boolean));
  return (index.bySlug.get(campaign.slug.toLowerCase()) ?? [])
    .filter((s) => !claimed.has(s.code))
    .map((s) => ({
      code: s.code,
      shortUrl: shortUrlFor(s.code),
      url: s.url,
      label: s.label,
      clicks: Number(s.clicks) || 0,
      createdAt: Number(s.createdAt) || 0,
    }));
}

/** Total short-link clicks for a campaign: its rows plus any orphans. */
export function campaignClicks(rows: LinkRow[], orphans: OrphanShortlink[]): number {
  return rows.reduce((n, r) => n + r.clicks, 0) + orphans.reduce((n, o) => n + o.clicks, 0);
}
