import { getRedis } from './redis';

// Shared UTM campaign store. Campaigns are named groupings; each holds many saved
// links (the same campaign promoted across platforms with different UTM params).
// Persisted to the SAME Upstash instance as the webhook execution store so every
// admin sees one shared set of campaigns. Unlike executions, these are long-lived
// — no TTL.
//
// Key contract:
//   utm:campaigns              — sorted set (score createdAt, member campaignId)
//   utm:campaign:<id>          — hash (UtmCampaign record)
//   utm:campaign:<id>:links    — sorted set (score createdAt, member linkId)
//   utm:link:<id>              — hash (UtmLink record)
const CAMPAIGNS_SET = 'utm:campaigns';
const CAMPAIGN_PREFIX = 'utm:campaign:';
const LINK_PREFIX = 'utm:link:';
const campaignLinksKey = (id: string) => `${CAMPAIGN_PREFIX}${id}:links`;

export interface UtmCampaign {
  id: string;
  name: string;
  slug: string; // the utm_campaign value, slugified from name
  createdAt: number;
  createdBy: string; // admin email
}

export interface UtmLink {
  id: string;
  campaignId: string;
  label: string; // optional friendly note, e.g. "Instagram bio link"
  url: string; // the full generated URL
  destination: string;
  source: string;
  medium: string;
  campaign: string;
  term: string;
  content: string;
  createdAt: number;
  createdBy: string; // admin email
}

export interface CampaignWithLinks {
  campaign: UtmCampaign;
  links: UtmLink[];
}

/** Slugify a display name into a stable utm_campaign value. */
export function slugifyCampaign(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The campaign slug a URL is attributed to, via its utm_campaign param.
 * Null for unparseable URLs or URLs without a utm_campaign.
 */
export function utmCampaignOfUrl(url: string): string | null {
  try {
    const raw = new URL(url).searchParams.get('utm_campaign');
    return raw ? slugifyCampaign(raw) || null : null;
  } catch {
    return null;
  }
}

async function getAllCampaigns(): Promise<UtmCampaign[]> {
  const redis = getRedis();
  if (!redis) return [];

  const ids = await redis.zrange<string[]>(CAMPAIGNS_SET, 0, -1, { rev: true });
  if (ids.length === 0) return [];

  const pipeline = redis.pipeline();
  for (const id of ids) {
    pipeline.hgetall(`${CAMPAIGN_PREFIX}${id}`);
  }
  const results = await pipeline.exec<Array<UtmCampaign | null>>();
  return results.filter((r): r is UtmCampaign => Boolean(r && r.id));
}

async function getLinksForCampaign(campaignId: string): Promise<UtmLink[]> {
  const redis = getRedis();
  if (!redis) return [];

  // Oldest-first within a campaign so the list reads chronologically.
  const ids = await redis.zrange<string[]>(campaignLinksKey(campaignId), 0, -1);
  if (ids.length === 0) return [];

  const pipeline = redis.pipeline();
  for (const id of ids) {
    pipeline.hgetall(`${LINK_PREFIX}${id}`);
  }
  const results = await pipeline.exec<Array<UtmLink | null>>();
  return results.filter((r): r is UtmLink => Boolean(r && r.id));
}

/** All campaigns (newest-first) with their links (oldest-first within each). */
export async function listCampaignsWithLinks(): Promise<CampaignWithLinks[]> {
  const campaigns = await getAllCampaigns();
  const withLinks = await Promise.all(
    campaigns.map(async (campaign) => ({
      campaign,
      links: await getLinksForCampaign(campaign.id),
    }))
  );
  return withLinks;
}

/**
 * Create a campaign, or return the existing one if a campaign with the same slug
 * already exists (so the team converges on one campaign per name).
 */
export async function createCampaign(params: {
  name: string;
  createdBy: string;
}): Promise<UtmCampaign | null> {
  const redis = getRedis();
  if (!redis) return null;

  const name = params.name.trim();
  const slug = slugifyCampaign(name);
  if (!name || !slug) return null;

  const existing = (await getAllCampaigns()).find((c) => c.slug === slug);
  if (existing) return existing;

  const campaign: UtmCampaign = {
    id: crypto.randomUUID(),
    name,
    slug,
    createdAt: Date.now(),
    createdBy: params.createdBy,
  };

  const pipeline = redis.pipeline();
  pipeline.hset(`${CAMPAIGN_PREFIX}${campaign.id}`, campaign);
  pipeline.zadd(CAMPAIGNS_SET, { score: campaign.createdAt, member: campaign.id });
  await pipeline.exec();

  return campaign;
}

/** Delete a campaign, its link set, and every link hash it contains. */
export async function deleteCampaign(id: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const linkIds = await redis.zrange<string[]>(campaignLinksKey(id), 0, -1);

  const pipeline = redis.pipeline();
  for (const linkId of linkIds) {
    pipeline.del(`${LINK_PREFIX}${linkId}`);
  }
  pipeline.del(campaignLinksKey(id));
  pipeline.del(`${CAMPAIGN_PREFIX}${id}`);
  pipeline.zrem(CAMPAIGNS_SET, id);
  await pipeline.exec();
}

/** Save a link under an existing campaign. Returns null if the campaign is gone. */
export async function saveLink(
  input: Omit<UtmLink, 'id' | 'createdAt'>
): Promise<UtmLink | null> {
  const redis = getRedis();
  if (!redis) return null;

  const campaignExists = await redis.exists(`${CAMPAIGN_PREFIX}${input.campaignId}`);
  if (!campaignExists) return null;

  const link: UtmLink = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  };

  const pipeline = redis.pipeline();
  pipeline.hset(`${LINK_PREFIX}${link.id}`, link);
  pipeline.zadd(campaignLinksKey(link.campaignId), { score: link.createdAt, member: link.id });
  await pipeline.exec();

  return link;
}

/** Relabel a saved link. Only the friendly label changes; the URL/UTM params and
 * campaign membership are untouched. Returns the updated link, or null if it's
 * gone or storage is unavailable. */
export async function updateLinkLabel(id: string, label: string): Promise<UtmLink | null> {
  const redis = getRedis();
  if (!redis) return null;

  const exists = await redis.exists(`${LINK_PREFIX}${id}`);
  if (!exists) return null;

  await redis.hset(`${LINK_PREFIX}${id}`, { label: label.trim() });
  return (await redis.hgetall(`${LINK_PREFIX}${id}`)) as UtmLink | null;
}

/** Delete a single saved link, removing it from its campaign's link set. */
export async function deleteLink(id: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const link = (await redis.hgetall(`${LINK_PREFIX}${id}`)) as UtmLink | null;

  const pipeline = redis.pipeline();
  pipeline.del(`${LINK_PREFIX}${id}`);
  if (link?.campaignId) {
    pipeline.zrem(campaignLinksKey(link.campaignId), id);
  }
  await pipeline.exec();
}
