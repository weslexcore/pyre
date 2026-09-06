// The Momence side of a guest profile: the account, what they have bought,
// and the sessions they have come to — read live, never mirrored, in keeping
// with the rest of this app. One call here fans out to three or four Host
// API requests, so it is its own route (/api/admin/guest-momence) and the
// profile page paints our own data first and fills this panel in behind it.
//
// Every part degrades on its own. A failed history call still leaves the
// packs readable, and `errors` tells the island which panel to caveat rather
// than blanking the whole thing.

import {
  type BoughtMembership,
  fetchHostMember,
  fetchMemberActivePacks,
  fetchMemberBoughtMemberships,
  fetchMemberSessions,
  type HostMember,
} from '@/lib/momence/host-api';
import {
  type HistorySummary,
  type MembershipStanding,
  membershipStanding,
  normalizeHistoryEntry,
  type PackSummary,
  type RawMemberSession,
  summarizeHistory,
  summarizePack,
} from './insights';

export interface MomenceAccount {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
  /** Booked (any state) and actually checked in, per Momence's counters. */
  visitsBooked: number;
  visitsAttended: number;
  tags: string[];
  /** Momence's own custom customer fields, as label/value pairs. */
  customerFields: { label: string; value: string }[];
}

export interface GuestMomenceSnapshot {
  account: MomenceAccount | null;
  standing: MembershipStanding;
  /** Live purchases: current subscription, packs with credits left. */
  activePacks: PackSummary[];
  /**
   * Everything they have ever bought, newest first — or null when this
   * Momence revision does not serve the history endpoint.
   */
  purchaseHistory: PackSummary[] | null;
  history: HistorySummary | null;
  /** Which panels failed, in words the island can show. */
  errors: string[];
  fetchedAt: string;
}

export function accountFromMember(member: HostMember): MomenceAccount {
  return {
    id: String(member.id),
    name: [member.firstName, member.lastName].filter(Boolean).join(' ').trim() || member.email,
    email: (member.email ?? '').trim().toLowerCase(),
    phone: member.phoneNumber ?? null,
    firstSeen: member.firstSeen ?? null,
    lastSeen: member.lastSeen ?? null,
    visitsBooked: member.visits?.total ?? 0,
    visitsAttended: member.visits?.totalVisits ?? 0,
    tags: (member.customerTags ?? []).map((t) => t.name).filter(Boolean),
    customerFields: (member.customerFields ?? [])
      .filter((f) => f.label && f.value != null && String(f.value).trim() !== '')
      .map((f) => ({ label: f.label, value: String(f.value) })),
  };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Newest purchase first; Momence does not promise an order. */
function sortPacks(packs: BoughtMembership[]): PackSummary[] {
  return [...packs]
    .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''))
    .map(summarizePack);
}

/**
 * Everything the profile's Momence panel shows, fetched in parallel. `fresh`
 * bypasses the 20h pack cache the journey sweeps rely on — for the "Refresh"
 * button, when staff know a purchase just happened.
 */
export async function loadMomenceSnapshot(
  memberId: number,
  { fresh = false }: { fresh?: boolean } = {}
): Promise<GuestMomenceSnapshot> {
  const errors: string[] = [];

  const [memberResult, activeResult, historyResult, sessionsResult] = await Promise.allSettled([
    fetchHostMember(memberId),
    fetchMemberActivePacks(memberId, { fresh }),
    fetchMemberBoughtMemberships(memberId),
    fetchMemberSessions(memberId),
  ]);

  let account: MomenceAccount | null = null;
  if (memberResult.status === 'fulfilled') {
    account = accountFromMember(memberResult.value);
  } else {
    console.error(`[guests] member ${memberId} lookup failed:`, message(memberResult.reason));
    errors.push('account');
  }

  let activePacks: PackSummary[] = [];
  if (activeResult.status === 'fulfilled') {
    activePacks = sortPacks(activeResult.value);
  } else {
    console.error(`[guests] member ${memberId} packs failed:`, message(activeResult.reason));
    errors.push('purchases');
  }

  let purchaseHistory: PackSummary[] | null = null;
  if (historyResult.status === 'fulfilled') {
    purchaseHistory = historyResult.value ? sortPacks(historyResult.value) : null;
  } else {
    console.error(`[guests] member ${memberId} history failed:`, message(historyResult.reason));
    // Not an error the island needs to show: the active list still stands
    // in, and the history endpoint is best-effort by design.
  }

  let history: HistorySummary | null = null;
  if (sessionsResult.status === 'fulfilled') {
    const entries = (sessionsResult.value as RawMemberSession[])
      .map(normalizeHistoryEntry)
      .filter((e): e is NonNullable<typeof e> => e !== null);
    history = summarizeHistory(entries);
  } else {
    console.error(`[guests] member ${memberId} sessions failed:`, message(sessionsResult.reason));
    errors.push('sessions');
  }

  return {
    account,
    standing: membershipStanding(activePacks),
    activePacks,
    purchaseHistory,
    history,
    errors,
    fetchedAt: new Date().toISOString(),
  };
}
