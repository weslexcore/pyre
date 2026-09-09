// Where a campaign is in its run, from its dates and today's date in the
// business's timezone. Archived wins over everything; an unset start or end
// is open-ended.

import type { UtmCampaign } from './types';

export type CampaignPhase = 'live' | 'upcoming' | 'ended' | 'archived';

export function campaignPhase(
  campaign: Pick<UtmCampaign, 'status' | 'startsAt' | 'endsAt'>,
  todayYmd: string
): CampaignPhase {
  if (campaign.status === 'archived') return 'archived';
  if (campaign.startsAt && campaign.startsAt > todayYmd) return 'upcoming';
  if (campaign.endsAt && campaign.endsAt < todayYmd) return 'ended';
  return 'live';
}

/** Today as YYYY-MM-DD on the bathhouse clock (New York). */
export function todayYmd(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export const PHASE_LABEL: Record<CampaignPhase, string> = {
  live: 'Live',
  upcoming: 'Upcoming',
  ended: 'Ended',
  archived: 'Archived',
};
