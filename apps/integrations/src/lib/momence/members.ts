// Member lookups the webhook paths, the backfill, and the referral and
// first-timer checks share, on top of momenceRequest. Server-only.

import { createWebhookLogger } from '@pyre/webhook-core';
import { momenceRequest } from './host-api';

const log = createWebhookLogger('Momence');

export interface MomenceMemberData {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  birthday: string;
  tags: string[];
}

interface Paginated<T> {
  payload?: T[];
  pagination?: { totalCount?: number; total?: number };
}

function mapMemberData(data: Record<string, unknown>): MomenceMemberData {
  const customerFields = data.customerFields as { type: string; value: string }[] | undefined;
  const birthdayField = customerFields?.find((f) => f.type === 'date-of-birth');
  const customerTags = data.customerTags as { name: string }[] | undefined;

  return {
    email: data.email as string,
    firstName: data.firstName as string,
    lastName: data.lastName as string,
    phone: (data.phoneNumber as string) ?? '',
    birthday: birthdayField?.value ?? '',
    tags: customerTags?.map((t) => t.name) ?? [],
  };
}

export async function fetchMomenceMember(memberId: string): Promise<MomenceMemberData> {
  log.info(`Fetching member ${memberId} from Momence API`);
  const data = await momenceRequest<Record<string, unknown>>('GET', `/host/members/${memberId}`);
  log.info(`Member ${memberId} fetched successfully`, {
    email: data.email,
    phoneNumber: data.phoneNumber,
    customerFieldCount: (data.customerFields as unknown[] | undefined)?.length ?? 0,
  });
  return mapMemberData(data);
}

// --- Member list (for backfill) ---

export interface FetchMomenceMembersResult {
  members: MomenceMemberData[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export async function fetchMomenceMembers(
  page: number,
  pageSize: number
): Promise<FetchMomenceMembersResult> {
  log.info(`Fetching members page ${page} (pageSize=${pageSize})`);
  const data = await momenceRequest<Paginated<Record<string, unknown>>>('GET', '/host/members', {
    query: {
      page: String(page),
      pageSize: String(pageSize),
      sortBy: 'lastSeenAt',
      sortOrder: 'DESC',
    },
  });

  const pagination = data.pagination ?? {};
  const members = (data.payload ?? []).map(mapMemberData);

  log.info(`Fetched ${members.length} members`, { pagination });

  return {
    members,
    totalCount: pagination.totalCount ?? pagination.total ?? members.length,
    page,
    pageSize,
  };
}

// --- Booking history ---
//
// Both checks read GET /host/members/{memberId}/sessions ("Get session
// bookings by a specific member"), a PaginatedResponseDto:
// { pagination: { totalCount, ... }, payload: [{ id, ... }] }.
// includeCancelled=true throughout: someone who booked and cancelled has
// still been a customer. Any error or unrecognized shape answers null, and
// the caller decides which way to fail.

function memberSessions(memberId: string, pageSize: number) {
  return momenceRequest<Paginated<{ id?: number }>>('GET', `/host/members/${memberId}/sessions`, {
    query: { page: '0', pageSize: String(pageSize), sortOrder: 'DESC', includeCancelled: 'true' },
  });
}

/**
 * Whether the booking that just triggered the webhook is the member's first:
 * true for a first-timer, false with prior bookings, null when it can't be
 * told (the first-timer email is then skipped rather than risk sending it to
 * an existing member).
 */
export async function isMemberFirstBooking(
  memberId: string,
  currentSessionBookingId: number
): Promise<boolean | null> {
  try {
    // pageSize=2 is enough: we only need to know whether >1 booking exists.
    const data = await memberSessions(memberId, 2);
    const total: unknown = data.pagination?.total ?? data.pagination?.totalCount;
    const payload = data.payload;

    // Log the shape once so we can confirm/refine against real responses.
    log.info(`First-timer check for member ${memberId}`, {
      total,
      payloadLength: Array.isArray(payload) ? payload.length : undefined,
      currentSessionBookingId,
    });

    // The just-created booking is included in the count.
    if (typeof total === 'number') return total <= 1;
    if (Array.isArray(payload)) {
      return payload.filter((b) => b?.id !== currentSessionBookingId).length === 0;
    }

    log.warn(
      `First-timer check: unrecognized response shape for member ${memberId} — skipping (fail safe)`
    );
    return null;
  } catch (error) {
    log.warn(`First-timer check failed for member ${memberId} — skipping (fail safe)`, error);
    return null;
  }
}

/**
 * Whether the member has any session booking at all — the referral
 * redemption path's first-time-customers-only rule. Null when unknown.
 */
export async function memberHasBookings(memberId: string): Promise<boolean | null> {
  try {
    const data = await memberSessions(memberId, 1);
    const total: unknown = data.pagination?.total ?? data.pagination?.totalCount;
    if (typeof total === 'number') return total > 0;
    if (Array.isArray(data.payload)) return data.payload.length > 0;
    return null;
  } catch (error) {
    log.warn(`Booking-history check failed for member ${memberId}`, error);
    return null;
  }
}
