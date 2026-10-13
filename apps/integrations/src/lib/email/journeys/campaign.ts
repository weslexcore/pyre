import { createCampaign, listCampaigns } from '@pyre/webhook-core';
import { resolveDestination } from '@/lib/campaigns/links';
import { LANDING_ORIGIN } from '@/lib/campaigns/server';

// The link between a journey and a campaign in the Campaigns tool. A journey's
// email links carry its campaign's slug as utm_campaign, so the journey's
// visits, bookings and purchases land on that campaign's row (with its goals)
// on /admin/campaigns — set once here instead of matched up by hand.

export interface CampaignOption {
  id: string;
  slug: string;
  name: string;
  archived: boolean;
}

export async function listCampaignOptions(): Promise<CampaignOption[]> {
  try {
    return (await listCampaigns()).map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      archived: c.status === 'archived',
    }));
  } catch {
    return [];
  }
}

/**
 * The campaign for a journey: a new evergreen campaign named after it, or —
 * when a campaign by that name already exists — that one, so the team never
 * ends up with two campaigns under one name.
 */
export async function ensureJourneyCampaign(
  journey: { id: string; name: string },
  actor: string
): Promise<
  { ok: true; campaign: CampaignOption; created: boolean } | { ok: false; error: string }
> {
  const home = resolveDestination(LANDING_ORIGIN, 'home', '');
  const result = await createCampaign({
    name: journey.name,
    type: 'evergreen',
    destinationKind: 'home',
    destinationValue: '',
    destinationUrl: home.ok ? home.url : `${LANDING_ORIGIN}/`,
    startsAt: '',
    endsAt: '',
    notes: `Email journey - its emails' links report here. Edit the journey at /admin/journeys/${journey.id}.`,
    goals: [],
    createdBy: actor,
  });
  if (result.ok) {
    const c = result.campaign;
    return {
      ok: true,
      created: true,
      campaign: { id: c.id, slug: c.slug, name: c.name, archived: false },
    };
  }
  if (result.reason === 'slug_taken') {
    const c = result.existing;
    return {
      ok: true,
      created: false,
      campaign: { id: c.id, slug: c.slug, name: c.name, archived: c.status === 'archived' },
    };
  }
  return {
    ok: false,
    error:
      result.reason === 'storage_unavailable'
        ? 'Campaign storage is unavailable - try again'
        : 'That name can not be turned into a campaign',
  };
}
