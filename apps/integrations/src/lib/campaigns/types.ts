// Vocabulary and API shapes for the Campaigns tool. Client-bundle-safe: only
// type imports from the store, so the islands never pull in the Redis client.

import type {
  CampaignGoal,
  CampaignGoalMetric,
  CampaignStatus,
  CampaignType,
  DestinationKind,
  UtmCampaign,
  UtmLink,
} from '@pyre/webhook-core';

export type {
  CampaignGoal,
  CampaignGoalMetric,
  CampaignStatus,
  CampaignType,
  DestinationKind,
  UtmCampaign,
  UtmLink,
};

export const CAMPAIGN_TYPES: ReadonlyArray<{ key: CampaignType; label: string; hint: string }> = [
  {
    key: 'event',
    label: 'Event',
    hint: 'A one-off session or gathering on the events page.',
  },
  {
    key: 'sale',
    label: 'Sale or offer',
    hint: 'A discount, intro offer, or limited-time deal.',
  },
  {
    key: 'newsletter',
    label: 'Newsletter',
    hint: 'One send of the monthly email. Name it by month.',
  },
  {
    key: 'launch',
    label: 'Launch',
    hint: 'Something new: a membership, a series, a space.',
  },
  {
    key: 'evergreen',
    label: 'Evergreen',
    hint: 'Always-on links, like the Instagram bio or a printed sign.',
  },
  { key: 'other', label: 'Other', hint: 'Anything that does not fit above.' },
];

export const CAMPAIGN_STATUSES: readonly CampaignStatus[] = ['active', 'archived'];

export function campaignTypeLabel(type: string): string {
  return CAMPAIGN_TYPES.find((t) => t.key === type)?.label ?? 'Other';
}

export const DESTINATION_KINDS: ReadonlyArray<{
  key: Exclude<DestinationKind, ''>;
  label: string;
  hint: string;
}> = [
  { key: 'home', label: 'Home page', hint: 'pyresauna.com' },
  { key: 'events', label: 'Events page', hint: 'The full schedule.' },
  { key: 'linktree', label: 'Link tree', hint: 'pyresauna.com/hi, the link-in-bio page.' },
  { key: 'event', label: 'One event', hint: 'Opens straight to a session.' },
  { key: 'blog', label: 'Blog post', hint: 'A published article.' },
  { key: 'partner', label: 'Partner page', hint: 'A partner offer page, like /bft.' },
  { key: 'custom', label: 'Another site', hint: 'Eventbrite, a partner, anything external.' },
];

/** A partner from the registry whose page the destination picker can target. */
export interface PartnerRef {
  slug: string;
  name: string;
}

/** A published blog article the destination picker can target. */
export interface BlogPostRef {
  slug: string;
  title: string;
}

/** The fields of the landing page's event shape this tool renders (the
 * events proxy passes the landing /api/events payload through unchanged). */
export interface EventOption {
  id: string;
  title: string;
  date?: string;
  time?: string;
}

/** A campaign as the index lists it. */
export interface CampaignSummary extends UtmCampaign {
  linkCount: number;
  /** Short-link clicks across every link in the campaign. */
  clicks: number;
}

/** A generated link as the detail page renders it. */
export interface LinkRow extends UtmLink {
  shortUrl: string | null;
  clicks: number;
}

/** A short link carrying this campaign's utm_campaign but not tied to any
 * link record — minted by the old free-form tool or by hand. */
export interface OrphanShortlink {
  code: string;
  shortUrl: string;
  url: string;
  label: string;
  clicks: number;
  createdAt: number;
}

export interface CampaignListResponse {
  campaigns: CampaignSummary[];
}

export interface CampaignDetailResponse {
  campaign: UtmCampaign;
  links: LinkRow[];
  otherShortlinks: OrphanShortlink[];
  /** The landing-site origin links are built against. */
  origin: string;
}
