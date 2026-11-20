// Pooled booking model for the events schedule.
//
// Sessions carrying a pooled tag (see POOLED_TAG_CONFIGS) are sold as hourly
// entry slots plus any number of full-length sessions at the same start +
// location (Open Hours: 1hr/2hr/3hr/4hr; Social evenings: 1hr entries with a
// 3hr full evening). The schedule shows only the entry slots; every
// full-length session sharing an entry slot's start is kept in Momence but
// hidden from the schedule and surfaces as a longer duration option in that
// slot's details modal (sorted shortest to longest), so the whole visit stays a
// single Momence checkout. Standalone full-length sessions (no entry-slot
// counterpart) still render as their own row. Every option is gated by the
// shared occupancy pool AND its own Momence capacity — except for own-pool
// tags (Special Event), which pair sessions the same way but never touch the
// floor pool: their sessions pool among themselves, capped per clock-hour at
// the sessions' own Momence capacity, and only become pooled rows when they
// pair with or overlap another session of the tag.
//
// Pure functions only — no React — so the model can be exercised directly
// (see scripts/verify-booking-model.ts).

import {
  bookedFromSpots,
  bypassesPool,
  computeHourlyCaps,
  computeHourlyOccupancy,
  computeHourlySessionCounts,
  maxOccupancyForLocation,
  type OccupancySession,
  overlapsAnotherSession,
  ownPoolSpotsLeftForSlot,
  type PooledTagConfig,
  pooledConfigForTags,
  poolSpotsLeftForSlot,
} from '@/lib/capacity';
import { creditsForPriceUsd } from '@/lib/credits';
import type { EventItem, PooledBookingOption } from '@/lib/types';

// Sessions at or above this duration count as the "full-length" partner; below
// it they're hourly entry slots. The actual duration (120, 180, …) comes from
// Momence — labels are derived dynamically.
const LONG_SESSION_MIN_MINUTES = 90;

export function eventHasTag(event: EventItem, tag: string): boolean {
  if (!Array.isArray(event.tags)) return false;
  const lower = tag.toLowerCase();
  return event.tags.some((t) => t.trim().toLowerCase() === lower);
}

function isLongSession(event: EventItem): boolean {
  return (event.durationMinutes ?? 0) >= LONG_SESSION_MIN_MINUTES;
}
function isEntrySlot(event: EventItem): boolean {
  const minutes = event.durationMinutes ?? 0;
  return minutes > 0 && minutes < LONG_SESSION_MIN_MINUTES;
}
// Pairing key: an entry slot and its full-length sessions pair only when they
// share tag, location, and exact start time.
function pooledStartKey(config: PooledTagConfig, event: EventItem): string {
  return `${config.tag}__${event.location}__${event.isoDate ?? event.id}`;
}
function durationLabel(minutes: number): string {
  if (!minutes) return 'Session';
  if (minutes === 60) return '1 hour';
  if (minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} min`;
}

// One own-pool tag's sessions pooled among themselves (see PooledTagConfig.ownPool).
interface OwnPool {
  occupancy: Map<string, number>;
  caps: Map<string, number>;
  sessionCounts: Map<string, number>;
}

interface Pools {
  floor: Map<string, number>;
  own: Map<PooledTagConfig, OwnPool>;
}

function toOccupancySession(e: EventItem): OccupancySession {
  return {
    isoDate: e.isoDate,
    durationMinutes: e.durationMinutes,
    location: e.location,
    booked: bookedFromSpots(e.totalSpots, e.spotsRemaining),
    totalSpots: e.totalSpots,
  };
}

function gatedSpotsLeft(event: EventItem, config: PooledTagConfig, pools: Pools): number {
  const sessionRemaining = event.spotsRemaining ?? Number.POSITIVE_INFINITY;
  const own = pools.own.get(config);
  if (own) {
    const pool = ownPoolSpotsLeftForSlot(event, own.occupancy, own.caps);
    return Math.max(0, Math.min(pool, sessionRemaining));
  }
  const max = maxOccupancyForLocation(event.location);
  if (bypassesPool(event.totalSpots, max)) {
    // High-capacity event: limited only by its own Momence capacity.
    return Math.max(0, sessionRemaining);
  }
  const pool = poolSpotsLeftForSlot(event, pools.floor, max);
  return Math.max(0, Math.min(pool, sessionRemaining));
}

function toBookingOption(
  event: EventItem,
  config: PooledTagConfig,
  pools: Pools
): PooledBookingOption {
  const minutes = event.durationMinutes ?? 0;
  const spotsLeft = gatedSpotsLeft(event, config, pools);
  // Credit cost comes from the Momence drop-in price; fall back to 1 credit per
  // hour only when the price is missing.
  const credits = creditsForPriceUsd(event.priceUsd) ?? Math.max(1, Math.round(minutes / 60));
  return {
    label: `Book ${durationLabel(minutes)}`,
    minutes,
    href: event.cta?.href ?? '#',
    spotsLeft,
    soldOut: spotsLeft <= 0,
    credits,
    priceUsd: event.priceUsd,
  };
}

export interface PooledBookingModel {
  // Booking options for each *displayed* pooled event, keyed by event id.
  optionsById: Map<string, PooledBookingOption[]>;
  // Full-length sessions hidden from the schedule (they back an entry slot's option).
  hiddenIds: Set<string>;
}

export function buildPooledBookingModel(events: EventItem[]): PooledBookingModel {
  const pooled: Array<{ event: EventItem; config: PooledTagConfig }> = [];
  for (const event of events) {
    if (event.isPrivate) continue;
    const config = pooledConfigForTags(event.tags);
    if (config) pooled.push({ event, config });
  }

  // One occupancy map across every pooled tag: occupancy is keyed by
  // location + clock-hour, so sessions of different tags in the same space at
  // the same time correctly count against each other.
  const floor = computeHourlyOccupancy(
    pooled
      // High-capacity and own-pool events bypass the floor pool entirely —
      // their attendees don't count against overlapping regular sessions.
      .filter(
        ({ event: e, config }) =>
          !config.ownPool && !bypassesPool(e.totalSpots, maxOccupancyForLocation(e.location))
      )
      .map(({ event: e }) => toOccupancySession(e))
  );

  // Each own-pool tag gets its own occupancy map, capped per clock-hour by the
  // capacity its sessions were created with.
  const own = new Map<PooledTagConfig, OwnPool>();
  const ownSessions = new Map<PooledTagConfig, OccupancySession[]>();
  for (const { event: e, config } of pooled) {
    if (!config.ownPool) continue;
    const list = ownSessions.get(config);
    if (list) list.push(toOccupancySession(e));
    else ownSessions.set(config, [toOccupancySession(e)]);
  }
  for (const [config, sessions] of ownSessions) {
    own.set(config, {
      occupancy: computeHourlyOccupancy(sessions),
      caps: computeHourlyCaps(sessions),
      sessionCounts: computeHourlySessionCounts(sessions),
    });
  }
  const pools: Pools = { floor, own };

  // Every full-length session at a given start (2hr, 3hr, 4hr, …) — each one
  // becomes its own duration option on the entry slot sharing that start.
  const longByStart = new Map<string, EventItem[]>();
  const entryStarts = new Set<string>();
  for (const { event: e, config } of pooled) {
    if (isLongSession(e)) {
      const key = pooledStartKey(config, e);
      const list = longByStart.get(key);
      if (list) list.push(e);
      else longByStart.set(key, [e]);
    } else if (isEntrySlot(e)) {
      entryStarts.add(pooledStartKey(config, e));
    }
  }

  // Hide full-length sessions when an entry slot shares their start — they
  // become that slot's longer duration options instead of their own rows.
  const hiddenIds = new Set<string>();
  for (const { event: e, config } of pooled) {
    if (isLongSession(e) && entryStarts.has(pooledStartKey(config, e))) hiddenIds.add(e.id);
  }

  const optionsById = new Map<string, PooledBookingOption[]>();
  for (const { event: e, config } of pooled) {
    if (hiddenIds.has(e.id)) continue;
    const partners = isEntrySlot(e) ? (longByStart.get(pooledStartKey(config, e)) ?? []) : [];
    // Own-pool sessions that neither pair with nor overlap another session of
    // the tag keep their ordinary row. One that overlaps (e.g. a 4pm 1hr entry
    // during a 3pm 2hr session) needs the pooled row so its spots reflect the
    // longer session's bookings.
    const ownPool = pools.own.get(config);
    if (ownPool && partners.length === 0 && !overlapsAnotherSession(e, ownPool.sessionCounts)) {
      continue;
    }
    if (isEntrySlot(e)) {
      const options = [toBookingOption(e, config, pools)];
      if (partners.length > 0) {
        // Offer every longer duration at this start, shortest first.
        const sorted = [...partners].sort(
          (a, b) => (a.durationMinutes ?? 0) - (b.durationMinutes ?? 0)
        );
        for (const partner of sorted) options.push(toBookingOption(partner, config, pools));
      } else if (config.missingPartnerFallback) {
        const { minutes, credits } = config.missingPartnerFallback;
        options.push({
          label: `Book ${durationLabel(minutes)}`,
          minutes,
          href: '#',
          spotsLeft: 0,
          soldOut: true,
          credits,
        });
      }
      optionsById.set(e.id, options);
    } else {
      // Standalone full-length (or odd-duration) pooled session — single option.
      optionsById.set(e.id, [toBookingOption(e, config, pools)]);
    }
  }

  return { optionsById, hiddenIds };
}
