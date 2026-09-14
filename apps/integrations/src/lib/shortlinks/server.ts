// Server-side helpers for the standalone short links routes. Imports the
// Redis-backed stores, so never import this from an island.
//
// Short links carry no owner. A campaign link claims one by the shortCode
// stored on the link record, so "standalone" is every short link no link
// record claims — the ones made on the short links page, plus anything the
// old free-form tool minted.

import {
  listCampaignsWithLinks,
  listShortLinks,
  type ShortLink,
  utmCampaignOfUrl,
} from '@pyre/webhook-core';
import { shortUrlFor } from '@/lib/campaigns/server';
import { destinationKey } from './alias';
import type { ExistingShortLink, StandaloneShortLink } from './types';

// Every short link the store holds, newest first. The index is a sorted set
// read in one range, so a page this size is one round-trip plus the hashes.
const SCAN_LIMIT = 1000;

interface Ownership {
  /** Short code -> the campaign whose link record claims it. */
  claimed: Map<string, { id: string; name: string }>;
  /** Campaign slug -> campaign, for the utm_campaign join on legacy links. */
  bySlug: Map<string, { id: string; name: string }>;
}

async function loadOwnership(): Promise<Ownership> {
  const claimed = new Map<string, { id: string; name: string }>();
  const bySlug = new Map<string, { id: string; name: string }>();
  for (const { campaign, links } of await listCampaignsWithLinks()) {
    const ref = { id: campaign.id, name: campaign.name };
    bySlug.set(campaign.slug.toLowerCase(), ref);
    for (const link of links) {
      if (link.shortCode) claimed.set(link.shortCode, ref);
    }
  }
  return { claimed, bySlug };
}

function clicksOf(link: ShortLink): number {
  return Number(link.clicks) || 0;
}

/** Every short link no campaign link owns, newest first. */
export async function listStandaloneShortLinks(): Promise<{
  links: StandaloneShortLink[];
  total: number;
  truncated: boolean;
}> {
  const [page, ownership] = await Promise.all([listShortLinks(SCAN_LIMIT, 0), loadOwnership()]);
  const links: StandaloneShortLink[] = [];
  for (const link of page.links) {
    if (!link.code || ownership.claimed.has(link.code)) continue;
    const slug = utmCampaignOfUrl(link.url);
    links.push({
      code: link.code,
      shortUrl: shortUrlFor(link.code),
      url: link.url,
      label: link.label ?? '',
      clicks: clicksOf(link),
      createdAt: Number(link.createdAt) || 0,
      createdBy: link.createdBy ?? '',
      campaign: slug ? (ownership.bySlug.get(slug) ?? null) : null,
    });
  }
  return { links, total: page.total, truncated: page.total > SCAN_LIMIT };
}

/**
 * Short links (campaign-owned or not) already sending people to the same
 * place as `url` — see destinationKey for what "same place" means. Newest
 * first. Empty when `url` is not an http(s) URL.
 */
export async function findShortLinksTo(url: string): Promise<ExistingShortLink[]> {
  const key = destinationKey(url);
  if (!key) return [];
  const [page, ownership] = await Promise.all([listShortLinks(SCAN_LIMIT, 0), loadOwnership()]);
  return page.links
    .filter((link) => link.code && destinationKey(link.url) === key)
    .map((link) => ({
      code: link.code,
      shortUrl: shortUrlFor(link.code),
      url: link.url,
      label: link.label ?? '',
      clicks: clicksOf(link),
      campaign: ownership.claimed.get(link.code) ?? null,
    }));
}
