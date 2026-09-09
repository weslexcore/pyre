import { getRedis } from './redis';
import { deleteShortLinks } from './shortlinks';

// Shared campaign store for the admin Campaigns tool. A campaign is the thing
// being promoted (an event, a sale, a launch, an evergreen link set); each
// holds many generated links — one per placement the campaign is promoted on
// (Instagram bio, newsletter, QR code…). Persisted to the SAME Upstash
// instance as the webhook execution store so every admin sees one shared set
// of campaigns. Unlike executions, these are long-lived — no TTL.
//
// Key contract:
//   utm:campaigns              — sorted set (score createdAt, member campaignId)
//   utm:campaign-slugs         — hash (slug -> campaignId), the uniqueness index
//   utm:campaign:<id>          — hash (UtmCampaign record)
//   utm:campaign:<id>:links    — sorted set (score createdAt, member linkId)
//   utm:link:<id>              — hash (UtmLink record)
//
// Records written before the campaign-centric rework lack the newer fields
// (type, status, destination, placementKey, shortCode…). Redis hashes tolerate
// that, and every read path fills defaults via normalizeCampaignRecord /
// normalizeLinkRecord, so legacy data needs no migration.
const CAMPAIGNS_SET = 'utm:campaigns';
const SLUG_INDEX = 'utm:campaign-slugs';
const CAMPAIGN_PREFIX = 'utm:campaign:';
const LINK_PREFIX = 'utm:link:';
const campaignLinksKey = (id: string) => `${CAMPAIGN_PREFIX}${id}:links`;

export type CampaignType = 'event' | 'sale' | 'newsletter' | 'launch' | 'evergreen' | 'other';
export type CampaignStatus = 'active' | 'archived';
/** Where a campaign's links point by default. '' on legacy campaigns. */
export type DestinationKind = 'home' | 'events' | 'event' | 'blog' | 'custom' | '';

export interface UtmCampaign {
  id: string;
  name: string;
  /** The utm_campaign value, slugified from name. Immutable once created. */
  slug: string;
  type: CampaignType;
  status: CampaignStatus;
  destinationKind: DestinationKind;
  /** Event id, blog slug, or external URL depending on destinationKind. */
  destinationValue: string;
  /** The resolved absolute URL links are built on (no UTM params). */
  destinationUrl: string;
  /** YYYY-MM-DD or ''. */
  startsAt: string;
  endsAt: string;
  notes: string;
  createdAt: number;
  createdBy: string; // admin email
  updatedAt: number;
}

export interface UtmLink {
  id: string;
  campaignId: string;
  label: string; // friendly note, e.g. "Instagram bio link"
  url: string; // the full generated URL
  destination: string;
  source: string;
  medium: string;
  campaign: string;
  term: string;
  content: string;
  /** Key from the placements catalog; '' for legacy or hand-built links. */
  placementKey: string;
  /** Variant suffix applied to utm_content ('' when none). */
  variant: string;
  /** Code of the /s/<code> short link minted for this link, '' when none. */
  shortCode: string;
  /** JSON-serialized QR appearance for this link, '' until customized. The
   * shape is owned by the integrations app (lib/qr/style); the store only
   * round-trips the string. */
  qrStyle: string;
  createdAt: number;
  createdBy: string; // admin email
}

export interface CampaignWithLinks {
  campaign: UtmCampaign;
  links: UtmLink[];
}

export interface CreateCampaignInput {
  name: string;
  type: CampaignType;
  destinationKind: DestinationKind;
  destinationValue: string;
  destinationUrl: string;
  startsAt: string;
  endsAt: string;
  notes: string;
  createdBy: string;
}

export type CreateCampaignResult =
  | { ok: true; campaign: UtmCampaign }
  | { ok: false; reason: 'slug_taken'; existing: UtmCampaign }
  | { ok: false; reason: 'invalid_name' | 'storage_unavailable' };

export type CampaignPatch = Partial<
  Pick<
    UtmCampaign,
    | 'name'
    | 'type'
    | 'status'
    | 'destinationKind'
    | 'destinationValue'
    | 'destinationUrl'
    | 'startsAt'
    | 'endsAt'
    | 'notes'
  >
>;

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

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const CAMPAIGN_TYPES: readonly CampaignType[] = [
  'event',
  'sale',
  'newsletter',
  'launch',
  'evergreen',
  'other',
];
const DESTINATION_KINDS: readonly DestinationKind[] = ['home', 'events', 'event', 'blog', 'custom'];

/** Fill defaults for records written before the campaign-centric rework. */
export function normalizeCampaignRecord(raw: Record<string, unknown>): UtmCampaign | null {
  const id = str(raw.id);
  if (!id) return null;
  const createdAt = num(raw.createdAt);
  const type = str(raw.type) as CampaignType;
  const kind = str(raw.destinationKind) as DestinationKind;
  return {
    id,
    name: str(raw.name),
    slug: str(raw.slug),
    type: CAMPAIGN_TYPES.includes(type) ? type : 'other',
    status: raw.status === 'archived' ? 'archived' : 'active',
    destinationKind: DESTINATION_KINDS.includes(kind) ? kind : '',
    destinationValue: str(raw.destinationValue),
    destinationUrl: str(raw.destinationUrl),
    startsAt: str(raw.startsAt),
    endsAt: str(raw.endsAt),
    notes: str(raw.notes),
    createdAt,
    createdBy: str(raw.createdBy),
    updatedAt: num(raw.updatedAt) || createdAt,
  };
}

export function normalizeLinkRecord(raw: Record<string, unknown>): UtmLink | null {
  const id = str(raw.id);
  if (!id) return null;
  return {
    id,
    campaignId: str(raw.campaignId),
    label: str(raw.label),
    url: str(raw.url),
    destination: str(raw.destination),
    source: str(raw.source),
    medium: str(raw.medium),
    campaign: str(raw.campaign),
    term: str(raw.term),
    content: str(raw.content),
    placementKey: str(raw.placementKey),
    variant: str(raw.variant),
    shortCode: str(raw.shortCode),
    qrStyle: str(raw.qrStyle),
    createdAt: num(raw.createdAt),
    createdBy: str(raw.createdBy),
  };
}

/** The utm_source a URL carries, lowercased; null when absent or unparseable. */
export function utmSourceOfUrl(url: string): string | null {
  try {
    const raw = new URL(url).searchParams.get('utm_source');
    return raw ? raw.trim().toLowerCase() || null : null;
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
  const results = await pipeline.exec<Array<Record<string, unknown> | null>>();
  const campaigns: UtmCampaign[] = [];
  for (const raw of results) {
    const campaign = raw ? normalizeCampaignRecord(raw) : null;
    if (campaign) campaigns.push(campaign);
  }
  return campaigns;
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
  const results = await pipeline.exec<Array<Record<string, unknown> | null>>();
  const links: UtmLink[] = [];
  for (const raw of results) {
    const link = raw ? normalizeLinkRecord(raw) : null;
    if (link) links.push(link);
  }
  return links;
}

/** All campaigns (newest-first). */
export async function listCampaigns(): Promise<UtmCampaign[]> {
  return getAllCampaigns();
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

export async function getCampaign(id: string): Promise<UtmCampaign | null> {
  const redis = getRedis();
  if (!redis || !id) return null;
  const raw = await redis.hgetall<Record<string, unknown>>(`${CAMPAIGN_PREFIX}${id}`);
  return raw ? normalizeCampaignRecord(raw) : null;
}

export async function getCampaignWithLinks(id: string): Promise<CampaignWithLinks | null> {
  const campaign = await getCampaign(id);
  if (!campaign) return null;
  return { campaign, links: await getLinksForCampaign(id) };
}

/**
 * Look a campaign up by its slug. The slug index only covers campaigns
 * created since the index existed; on a miss, fall back to scanning every
 * campaign and backfill the index entry for whatever it finds.
 */
export async function getCampaignBySlug(slug: string): Promise<UtmCampaign | null> {
  const redis = getRedis();
  if (!redis || !slug) return null;

  const indexed = await redis.hget<string>(SLUG_INDEX, slug);
  if (indexed) {
    const campaign = await getCampaign(indexed);
    if (campaign) return campaign;
    // Stale index entry (campaign hash gone) — drop it and fall through.
    await redis.hdel(SLUG_INDEX, slug);
  }

  const found = (await getAllCampaigns()).find((c) => c.slug === slug);
  if (found) await redis.hset(SLUG_INDEX, { [slug]: found.id });
  return found ?? null;
}

/**
 * Create a campaign. Fails with `slug_taken` (and the existing campaign) when
 * the slugified name is already in use, so the team converges on one campaign
 * per name instead of silently merging into it.
 */
export async function createCampaign(input: CreateCampaignInput): Promise<CreateCampaignResult> {
  const redis = getRedis();
  if (!redis) return { ok: false, reason: 'storage_unavailable' };

  const name = input.name.trim();
  const slug = slugifyCampaign(name);
  if (!name || !slug) return { ok: false, reason: 'invalid_name' };

  const existing = await getCampaignBySlug(slug);
  if (existing) return { ok: false, reason: 'slug_taken', existing };

  const now = Date.now();
  const campaign: UtmCampaign = {
    id: crypto.randomUUID(),
    name,
    slug,
    type: input.type,
    status: 'active',
    destinationKind: input.destinationKind,
    destinationValue: input.destinationValue,
    destinationUrl: input.destinationUrl,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    notes: input.notes,
    createdAt: now,
    createdBy: input.createdBy,
    updatedAt: now,
  };

  // hsetnx on the slug index is the race guard: two admins creating the same
  // name at once both pass the lookup above, but only one claims the slug.
  const claimed = await redis.hsetnx(SLUG_INDEX, slug, campaign.id);
  if (!claimed) {
    const winner = await getCampaignBySlug(slug);
    if (winner) return { ok: false, reason: 'slug_taken', existing: winner };
  }

  const pipeline = redis.pipeline();
  pipeline.hset(`${CAMPAIGN_PREFIX}${campaign.id}`, campaign);
  pipeline.zadd(CAMPAIGNS_SET, { score: campaign.createdAt, member: campaign.id });
  await pipeline.exec();

  return { ok: true, campaign };
}

/**
 * Update a campaign's editable fields. The slug is never touched: it is baked
 * into every link already generated and joined against PostHog.
 */
export async function updateCampaign(id: string, patch: CampaignPatch): Promise<UtmCampaign | null> {
  const redis = getRedis();
  if (!redis) return null;

  const exists = await redis.exists(`${CAMPAIGN_PREFIX}${id}`);
  if (!exists) return null;

  const fields: Record<string, string | number> = { updatedAt: Date.now() };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) fields[key] = value;
  }
  await redis.hset(`${CAMPAIGN_PREFIX}${id}`, fields);
  return getCampaign(id);
}

/** Delete a campaign, its link set, every link hash, and their short links. */
export async function deleteCampaign(id: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const campaign = await getCampaign(id);
  const links = await getLinksForCampaign(id);
  const shortCodes = links.map((l) => l.shortCode).filter(Boolean);

  const pipeline = redis.pipeline();
  for (const link of links) {
    pipeline.del(`${LINK_PREFIX}${link.id}`);
  }
  pipeline.del(campaignLinksKey(id));
  pipeline.del(`${CAMPAIGN_PREFIX}${id}`);
  pipeline.zrem(CAMPAIGNS_SET, id);
  if (campaign?.slug) pipeline.hdel(SLUG_INDEX, campaign.slug);
  await pipeline.exec();

  if (shortCodes.length > 0) await deleteShortLinks(shortCodes);
}

export async function getLink(id: string): Promise<UtmLink | null> {
  const redis = getRedis();
  if (!redis || !id) return null;
  const raw = await redis.hgetall<Record<string, unknown>>(`${LINK_PREFIX}${id}`);
  return raw ? normalizeLinkRecord(raw) : null;
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

/** Update a link's friendly label, short code, and/or QR style. The URL, UTM
 * params, and campaign membership are untouched. Returns the updated link, or
 * null if it's gone or storage is unavailable. */
export async function updateLink(
  id: string,
  patch: Partial<Pick<UtmLink, 'label' | 'shortCode' | 'qrStyle'>>
): Promise<UtmLink | null> {
  const redis = getRedis();
  if (!redis) return null;

  const exists = await redis.exists(`${LINK_PREFIX}${id}`);
  if (!exists) return null;

  const fields: Record<string, string> = {};
  if (patch.label !== undefined) fields.label = patch.label.trim();
  if (patch.shortCode !== undefined) fields.shortCode = patch.shortCode;
  if (patch.qrStyle !== undefined) fields.qrStyle = patch.qrStyle;
  if (Object.keys(fields).length > 0) await redis.hset(`${LINK_PREFIX}${id}`, fields);
  return getLink(id);
}

/** Delete a single saved link (and its short link), removing it from its
 * campaign's link set. */
export async function deleteLink(id: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const link = await getLink(id);

  const pipeline = redis.pipeline();
  pipeline.del(`${LINK_PREFIX}${id}`);
  if (link?.campaignId) {
    pipeline.zrem(campaignLinksKey(link.campaignId), id);
  }
  await pipeline.exec();

  if (link?.shortCode) await deleteShortLinks([link.shortCode]);
}
