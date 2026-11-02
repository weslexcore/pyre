// What each guest on the Check Ins floor is on, and whether it's their first
// visit (lib/guests/plan.ts reads it). Two Momence calls a guest, so answers
// are kept in Redis for a few minutes: the floor refetches every half minute,
// and credits only move when someone books or buys. Packs are read fresh on a
// miss rather than through the 20h journey cache, since a credit spent on
// today's booking should show today.
//
// Best-effort, inside a time budget: a guest we couldn't look up is simply
// missing from the map and fills in on a later refetch. Server-only.

import { getRedis } from '@pyre/webhook-core';
import {
  fetchHostMember,
  fetchMemberActivePacks,
  getIntroOfferMembershipIds,
} from '@/lib/momence/host-api';
import type { FloorGuest } from './floor-timing';
import { type FloorMember, guestPlan, isFirstVisit } from './plan';

const CACHE_PREFIX = 'cache:floor-member:';
const CACHE_TTL_SECONDS = 5 * 60;
const BUDGET_MS = 6_000;
const CONCURRENCY = 4;

async function lookUp(memberId: string, checkedIn: boolean, nowMs: number): Promise<FloorMember> {
  const id = Number(memberId);
  const [member, packs] = await Promise.all([
    fetchHostMember(id),
    fetchMemberActivePacks(id, { fresh: true }),
  ]);
  return {
    plan: guestPlan(packs, getIntroOfferMembershipIds(), nowMs),
    firstVisit: isFirstVisit(member.visits?.totalVisits ?? 0, checkedIn),
  };
}

/** Standing for every guest with a Momence member id, by member id. */
export async function loadFloorMembers(
  guests: readonly FloorGuest[],
  nowMs: number
): Promise<Record<string, FloorMember>> {
  // One lookup per person; checked in on any of their bookings counts.
  const people = new Map<string, boolean>();
  for (const guest of guests) {
    if (!guest.memberId) continue;
    people.set(guest.memberId, (people.get(guest.memberId) ?? false) || guest.checkedIn);
  }
  if (people.size === 0) return {};

  const ids = [...people.keys()];
  const redis = getRedis();
  const members: Record<string, FloorMember> = {};
  if (redis) {
    try {
      const cached = await redis.mget<(FloorMember | null)[]>(
        ...ids.map((id) => `${CACHE_PREFIX}${id}`)
      );
      cached.forEach((hit, i) => {
        if (hit) members[ids[i]] = hit;
      });
    } catch (e) {
      console.error('[guests/floor] member cache read failed:', e instanceof Error ? e.message : e);
    }
  }

  const missing = ids.filter((id) => !members[id]);
  const deadline = Date.now() + BUDGET_MS;
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= missing.length || Date.now() > deadline) return;
      const id = missing[index];
      try {
        const member = await lookUp(id, people.get(id) ?? false, nowMs);
        members[id] = member;
        if (redis) await redis.set(`${CACHE_PREFIX}${id}`, member, { ex: CACHE_TTL_SECONDS });
      } catch (e) {
        console.error(
          `[guests/floor] member ${id} lookup failed:`,
          e instanceof Error ? e.message : e
        );
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, missing.length) }, worker));
  return members;
}
