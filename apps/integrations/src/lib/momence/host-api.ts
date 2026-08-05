import { createWebhookLogger, getRedis } from '@pyre/webhook-core';
import { getHostAccessToken } from '@/lib/webhooks/momence';

const log = createWebhookLogger('Momence Host API');

const MOMENCE_API_V2 = 'https://api.momence.com/api/v2';

// Host-token API surface used by the journey engine's sweeps. Momence is the
// source of truth — none of this data is mirrored; sweeps read it live at
// decision time. Only two short-TTL caches exist (per-member packs, the tag
// name->id map) to keep hourly sweeps from re-fetching what barely changes.

// --- Shared plumbing ---

interface Paginated<T> {
  payload: T[];
  pagination?: { totalCount?: number; total?: number };
}

async function momenceRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  options: { query?: Record<string, string>; body?: unknown } = {}
): Promise<T> {
  const accessToken = await getHostAccessToken();
  const qs = options.query ? `?${new URLSearchParams(options.query)}` : '';
  const url = `${MOMENCE_API_V2}${path}${qs}`;

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(options.body != null && { 'Content-Type': 'application/json' }),
    },
    ...(options.body != null && { body: JSON.stringify(options.body) }),
  });

  const text = await response.text();
  if (!response.ok) {
    log.error(`${method} ${path} failed: status=${response.status} body=${text.slice(0, 500)}`);
    throw new Error(`Momence API returned ${response.status} for ${method} ${path}`);
  }

  return text ? (JSON.parse(text) as T) : (undefined as T);
}

// --- Member list with server-side include/exclude filters ---

export interface MemberVisits {
  appointments: number;
  appointmentsVisits: number;
  bookings: number;
  bookingsVisits: number;
  openAreaVisits: number;
  /** appointments + bookings (booked, whether or not attended) */
  total: number;
  /** checked-in visits only — use this for "has actually come N times" */
  totalVisits: number;
}

export interface HostMember {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string | null;
  firstSeen: string;
  lastSeen: string;
  visits: MemberVisits;
  customerFields: { id: number; label: string; type: string; value: string }[];
  customerTags: { id: number; name: string }[];
}

// Subset of Momence's HostCustomersListFilterDto that journeys use. All
// criteria combine with the top-level `type` ('and'/'or'); customerTags
// supports exclusion via customerHaveTag: 'not-have'.
export interface MemberListFilter {
  type: 'and' | 'or';
  visits?: {
    count: { type: 'moreThan' | 'lessThan' | 'exactly'; value: number };
    dateType?: 'fixed' | 'flexible';
    startDate?: string | null;
    endDate?: string | null;
    timeUnitNumber?: number;
  };
  memberships?: {
    membershipState: 'active' | 'not-active' | 'cancelled' | 'expired' | 'none';
    membershipId?: number | null;
    membershipIds?: number[];
  }[];
  customerTags?: {
    type: 'and' | 'or';
    tags: number[];
    customerHaveTag: 'have' | 'not-have';
  };
  futureBookings?: {
    count: { type: 'moreThan' | 'lessThan' | 'exactly'; value: number };
  };
  lastContacted?: {
    type: 'fixed' | 'flexible';
    startDate?: string | null;
    endDate?: string | null;
    days?: number;
  };
}

export interface FetchMembersFilteredParams {
  page: number;
  pageSize?: number;
  /** Fuzzy name/email search (Momence's list-view search box). */
  query?: string;
  filter?: MemberListFilter;
  filterPreset?: 'with-active-membership';
  sortBy?: 'lastSeenAt' | 'firstSeenAt' | 'firstName' | 'lastName' | 'email';
  sortOrder?: 'ASC' | 'DESC';
}

export interface FetchMembersFilteredResult {
  members: HostMember[];
  totalCount: number;
}

export async function fetchMembersFiltered({
  page,
  pageSize = 100,
  query,
  filter,
  filterPreset,
  sortBy = 'lastSeenAt',
  sortOrder = 'DESC',
}: FetchMembersFilteredParams): Promise<FetchMembersFilteredResult> {
  const data = await momenceRequest<Paginated<HostMember>>('POST', '/host/members/list', {
    body: {
      page,
      pageSize,
      sortBy,
      sortOrder,
      ...(query && { query }),
      ...(filterPreset && { filterPreset }),
      ...(filter && { filter }),
    },
  });

  return {
    members: data.payload ?? [],
    totalCount: data.pagination?.totalCount ?? data.pagination?.total ?? 0,
  };
}

export async function fetchHostMember(memberId: number): Promise<HostMember> {
  return momenceRequest<HostMember>('GET', `/host/members/${memberId}`);
}

/**
 * Exact-match lookup by email. The `query` search is fuzzy (name OR email
 * substring), so filter the first page down to a case-insensitive exact hit.
 */
export async function findMemberByEmail(email: string): Promise<HostMember | null> {
  const target = email.trim().toLowerCase();
  const { members } = await fetchMembersFiltered({ page: 0, pageSize: 25, query: target });
  return members.find((m) => m.email?.toLowerCase() === target) ?? null;
}

/** Create a bare member record so it can be tagged before any purchase exists. */
export async function createMember(params: {
  email: string;
  firstName: string;
  lastName: string;
  phoneNumber?: string;
}): Promise<number> {
  const data = await momenceRequest<{ memberId: number }>('POST', '/host/members', {
    body: {
      email: params.email.trim().toLowerCase(),
      firstName: params.firstName,
      lastName: params.lastName,
      ...(params.phoneNumber && { phoneNumber: params.phoneNumber }),
    },
  });
  return data.memberId;
}

export async function updateMemberPhoneNumber(
  memberId: number,
  phoneNumber: string
): Promise<void> {
  await momenceRequest<void>('PUT', `/host/members/${memberId}/phone-number`, {
    body: { phoneNumber },
  });
}

// --- Bought memberships (subscriptions + credit packs) ---

export interface BoughtMembership {
  /** the purchased instance id (unique per purchase) */
  id: number;
  type: 'subscription' | 'on-demand-subscription' | 'package-events' | 'package-money' | 'patron';
  startDate: string | null;
  /** expiration; null = no expiry pressure */
  endDate: string | null;
  isFrozen: boolean;
  eventCreditsLeft: number | null;
  eventCreditsTotal: number | null;
  moneyCreditsLeft: number | null;
  moneyCreditsTotal: number | null;
  /** origin catalog membership (id/name) — match intro-offer ids against this */
  membership: { id: number; name: string } | null;
}

const PACKS_CACHE_PREFIX = 'cache:memberships:';
const PACKS_CACHE_TTL_SECONDS = 60 * 60 * 20; // 20h — refreshed at most once per daily sweep cycle

export async function fetchMemberActivePacks(
  memberId: number,
  { fresh = false }: { fresh?: boolean } = {}
): Promise<BoughtMembership[]> {
  const redis = getRedis();
  const cacheKey = `${PACKS_CACHE_PREFIX}${memberId}`;

  if (redis && !fresh) {
    const cached = await redis.get<BoughtMembership[]>(cacheKey);
    if (cached) return cached;
  }

  const data = await momenceRequest<Paginated<BoughtMembership>>(
    'GET',
    `/host/members/${memberId}/bought-memberships/active`,
    { query: { page: '0', pageSize: '100' } }
  );
  const packs = data.payload ?? [];

  if (redis) {
    await redis.set(cacheKey, packs, { ex: PACKS_CACHE_TTL_SECONDS });
  }

  return packs;
}

// --- Sales (experimental endpoint — the purchase-trigger source) ---

export type SaleItemType =
  | 'membership'
  | 'monthly-subscription'
  | 'event-credit'
  | 'money-credit'
  | 'gift-card'
  | 'session'
  | 'appointment'
  | 'product'
  | (string & {});

export interface SaleMember {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
}

export interface HostSaleItem {
  id: number;
  /** catalog item id (e.g. the membership id for membership sales) */
  saleItemId: number;
  itemType: SaleItemType;
  itemName: string;
  payingMember: SaleMember | null;
  targetMember: SaleMember | null;
  quantity: number;
  unitPriceExcludingTaxInCurrency: string;
}

export interface HostSale {
  id: number;
  saleDate: string;
  items: HostSaleItem[];
}

export async function fetchSales(
  page: number,
  pageSize = 50,
  sortOrder: 'ASC' | 'DESC' = 'DESC'
): Promise<HostSale[]> {
  const data = await momenceRequest<Paginated<HostSale>>('GET', '/host/sales', {
    query: { page: String(page), pageSize: String(pageSize), sortOrder },
  });
  return data.payload ?? [];
}

// --- Tags (name -> id map, plus write-back so staff see journey status) ---

export interface HostTag {
  id: number;
  name: string;
}

const TAGS_CACHE_KEY = 'cache:momence:tags';
const TAGS_CACHE_TTL_SECONDS = 60 * 60 * 24;

export async function fetchTagMap(): Promise<Record<string, number>> {
  const redis = getRedis();

  if (redis) {
    const cached = await redis.get<Record<string, number>>(TAGS_CACHE_KEY);
    if (cached) return cached;
  }

  const map: Record<string, number> = {};
  let page = 0;
  for (;;) {
    const data = await momenceRequest<Paginated<HostTag>>('GET', '/host/tags', {
      query: { page: String(page), pageSize: '100' },
    });
    const tags = data.payload ?? [];
    for (const tag of tags) map[tag.name.toLowerCase()] = tag.id;
    if (tags.length < 100) break;
    page += 1;
  }

  if (redis) {
    await redis.set(TAGS_CACHE_KEY, map, { ex: TAGS_CACHE_TTL_SECONDS });
  }

  return map;
}

export async function getTagIdByName(name: string): Promise<number | null> {
  const map = await fetchTagMap();
  return map[name.toLowerCase()] ?? null;
}

export async function assignMemberTag(memberId: number, tagId: number): Promise<void> {
  await momenceRequest<void>('POST', `/host/members/${memberId}/tags/${tagId}`);
}

// --- Intro-offer identification ---

export function getIntroOfferMembershipIds(): number[] {
  return (import.meta.env.MOMENCE_INTRO_OFFER_MEMBERSHIP_IDS ?? '')
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
}

// --- Schedule feed for the staff-scheduling sync (sessions + appointments) ---

export interface HostSession {
  id: number;
  name: string;
  startsAt: string;
  endsAt: string;
  isDraft: boolean;
  isCancelled?: boolean;
}

export interface AppointmentReservation {
  id: number;
  startsAt: string;
  endsAt: string | null;
  serviceName?: string;
  isCancelled?: boolean;
}

async function fetchAllPages<T>(path: string, query: Record<string, string>): Promise<T[]> {
  const items: T[] = [];
  let page = 0;
  for (;;) {
    const data = await momenceRequest<Paginated<T>>('GET', path, {
      query: { ...query, page: String(page), pageSize: '100' },
    });
    const batch = data.payload ?? [];
    items.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return items;
}

/** Upcoming classes in a UTC window, drafts and cancellations filtered out. */
export async function fetchHostSessions(params: {
  startAfter: string;
  startBefore: string;
}): Promise<HostSession[]> {
  const sessions = await fetchAllPages<HostSession>('/host/sessions', {
    startAfter: params.startAfter,
    startBefore: params.startBefore,
    sortBy: 'startsAt',
    sortOrder: 'ASC',
  });
  return sessions.filter((s) => !s.isDraft && !s.isCancelled);
}

/** Upcoming private appointment reservations in a UTC window. */
export async function fetchAppointmentReservations(params: {
  startAfter: string;
  startBefore: string;
}): Promise<AppointmentReservation[]> {
  const reservations = await fetchAllPages<AppointmentReservation>(
    '/host/appointments/reservations',
    {
      startAfter: params.startAfter,
      startBefore: params.startBefore,
    }
  );
  return reservations.filter((r) => !r.isCancelled);
}
