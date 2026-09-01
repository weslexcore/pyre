// Exercises the pooled booking model with synthetic Momence-shaped events.
// Run with: yarn tsx scripts/verify-booking-model.ts
//
// Covers: Social 1hr/3hr grouping (full evening hidden, entry slots pool-gated
// by the 3hr session's bookings), the Open Hours 1hr/2hr pair, an Open Hours
// slot selling 1/2/3/4 hours (every full-length session surfaces as an option,
// sorted by duration), the sold-out 2-hour fallback on a partner-less Open
// Hours slot, and a legacy high-capacity social that bypasses the pool.

import { buildPooledBookingModel } from '../src/lib/booking-model';
import type { EventItem } from '../src/lib/types';

const LOCATION = '1000 Westover Hills Blvd';

function makeEvent(partial: Partial<EventItem> & { id: string }): EventItem {
  return {
    title: partial.id,
    description: '',
    date: 'Sat, Aug 1',
    time: '6:00 PM',
    location: LOCATION,
    cta: { href: `https://momence.com/s/${partial.id}`, label: 'Book Now' },
    ...partial,
  } as EventItem;
}

const events: EventItem[] = [
  // Social evening: 3hr full evening at 6pm (10 booked) + 1hr entries at 6/7/8pm.
  makeEvent({
    id: 'social-3hr-6pm',
    tags: ['Social'],
    isoDate: '2026-08-01T22:00:00.000Z',
    durationMinutes: 180,
    totalSpots: 30,
    spotsRemaining: 20,
    priceUsd: 75,
  }),
  makeEvent({
    id: 'social-1hr-6pm',
    tags: ['Social'],
    isoDate: '2026-08-01T22:00:00.000Z',
    durationMinutes: 60,
    totalSpots: 30,
    spotsRemaining: 30,
    priceUsd: 25,
  }),
  makeEvent({
    id: 'social-1hr-7pm',
    tags: ['Social'],
    isoDate: '2026-08-01T23:00:00.000Z',
    durationMinutes: 60,
    totalSpots: 30,
    spotsRemaining: 28,
    priceUsd: 25,
  }),
  makeEvent({
    id: 'social-1hr-8pm',
    tags: ['Social'],
    isoDate: '2026-08-02T00:00:00.000Z',
    durationMinutes: 60,
    totalSpots: 30,
    spotsRemaining: 30,
    priceUsd: 25,
  }),
  // Open Hours pair at 10am: 1hr (5 booked) + 2hr partner (2 booked).
  makeEvent({
    id: 'oh-1hr-10am',
    tags: ['Open Hours'],
    isoDate: '2026-08-01T14:00:00.000Z',
    durationMinutes: 60,
    totalSpots: 20,
    spotsRemaining: 15,
    priceUsd: 25,
  }),
  makeEvent({
    id: 'oh-2hr-10am',
    tags: ['Open Hours'],
    isoDate: '2026-08-01T14:00:00.000Z',
    durationMinutes: 120,
    totalSpots: 10,
    spotsRemaining: 8,
    priceUsd: 50,
  }),
  // Open Hours at 2pm selling 1/2/3/4 hours. Listed out of order to prove the
  // options are sorted by duration rather than by Momence order.
  makeEvent({
    id: 'oh-4hr-2pm',
    tags: ['Open Hours'],
    isoDate: '2026-08-01T18:00:00.000Z',
    durationMinutes: 240,
    totalSpots: 10,
    spotsRemaining: 6,
    priceUsd: 100,
  }),
  makeEvent({
    id: 'oh-1hr-2pm',
    tags: ['Open Hours'],
    isoDate: '2026-08-01T18:00:00.000Z',
    durationMinutes: 60,
    totalSpots: 20,
    spotsRemaining: 20,
    priceUsd: 25,
  }),
  makeEvent({
    id: 'oh-3hr-2pm',
    tags: ['Open Hours'],
    isoDate: '2026-08-01T18:00:00.000Z',
    durationMinutes: 180,
    totalSpots: 10,
    spotsRemaining: 10,
    priceUsd: 75,
  }),
  makeEvent({
    id: 'oh-2hr-2pm',
    tags: ['Open Hours'],
    isoDate: '2026-08-01T18:00:00.000Z',
    durationMinutes: 120,
    totalSpots: 10,
    spotsRemaining: 9,
    priceUsd: 50,
  }),
  // Partner-less Open Hours 1hr at noon — should get the sold-out 2hr fallback.
  makeEvent({
    id: 'oh-1hr-noon',
    tags: ['Open Hours'],
    isoDate: '2026-08-01T16:00:00.000Z',
    durationMinutes: 60,
    totalSpots: 20,
    spotsRemaining: 20,
    priceUsd: 25,
  }),
  // Legacy high-capacity social — bypasses the pool, renders standalone.
  makeEvent({
    id: 'social-bypass',
    tags: ['Social'],
    isoDate: '2026-08-08T22:00:00.000Z',
    durationMinutes: 180,
    totalSpots: 60,
    spotsRemaining: 45,
    priceUsd: 40,
  }),
  // Non-pooled event — should get no options at all.
  makeEvent({
    id: 'guided-7pm',
    tags: ['Guided'],
    isoDate: '2026-08-01T23:00:00.000Z',
    durationMinutes: 60,
    totalSpots: 12,
    spotsRemaining: 12,
    priceUsd: 45,
  }),
];

const model = buildPooledBookingModel(events);

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}\n      expected ${e}\n      actual   ${a}`);
  }
}

const opts = (id: string) => model.optionsById.get(id);

console.log('Social 1hr/3hr grouping');
check('3hr full evening is hidden', model.hiddenIds.has('social-3hr-6pm'), true);
check('6pm entry offers two durations', opts('social-1hr-6pm')?.map((o) => o.minutes), [60, 180]);
check('3hr option label', opts('social-1hr-6pm')?.[1].label, 'Book 3 hours');
check('3hr option credits (from $75)', opts('social-1hr-6pm')?.[1].credits, 3);
// 3hr session has 10 booked, spanning 6/7/8pm; 7pm entry adds 2 more that hour.
check('6pm entry pool-gated to 20', opts('social-1hr-6pm')?.[0].spotsLeft, 20);
check('3hr option gated by busiest hour (7pm: 12 booked)', opts('social-1hr-6pm')?.[1].spotsLeft, 18);
check('7pm entry is single-option (no wrong fallback)', opts('social-1hr-7pm')?.length, 1);
check('7pm entry spots (12 booked that hour)', opts('social-1hr-7pm')?.[0].spotsLeft, 18);
check('8pm entry is single-option', opts('social-1hr-8pm')?.length, 1);
check('8pm entry spots (10 booked that hour)', opts('social-1hr-8pm')?.[0].spotsLeft, 20);

console.log('Open Hours 1hr/2hr pair (unchanged behavior)');
check('2hr partner is hidden', model.hiddenIds.has('oh-2hr-10am'), true);
check('10am slot offers two durations', opts('oh-1hr-10am')?.map((o) => o.minutes), [60, 120]);
check('10am 1hr capped by own Momence spots', opts('oh-1hr-10am')?.[0].spotsLeft, 15);
check('10am 2hr capped by own Momence spots', opts('oh-1hr-10am')?.[1].spotsLeft, 8);

console.log('Open Hours 1/2/3/4 hour slot surfaces every duration');
const twoPm = opts('oh-1hr-2pm');
check(
  'all full-length sessions are hidden',
  ['oh-2hr-2pm', 'oh-3hr-2pm', 'oh-4hr-2pm'].map((id) => model.hiddenIds.has(id)),
  [true, true, true]
);
check('2pm slot offers four durations, sorted', twoPm?.map((o) => o.minutes), [60, 120, 180, 240]);
check(
  'labels for each duration',
  twoPm?.map((o) => o.label),
  ['Book 1 hour', 'Book 2 hours', 'Book 3 hours', 'Book 4 hours']
);
check('credits from Momence prices', twoPm?.map((o) => o.credits), [1, 2, 3, 4]);
check(
  'hrefs point at each session',
  twoPm?.map((o) => o.href.split('/').pop()),
  ['oh-1hr-2pm', 'oh-2hr-2pm', 'oh-3hr-2pm', 'oh-4hr-2pm']
);
// 2hr has 1 booked (2–4pm), 4hr has 4 booked (2–6pm): 2pm/3pm hours carry 5.
check('1hr capped by own Momence spots (pool would allow 25)', twoPm?.[0].spotsLeft, 20);
check('2hr capped by own Momence spots', twoPm?.[1].spotsLeft, 9);
check('3hr capped by own Momence spots', twoPm?.[2].spotsLeft, 10);
check('4hr capped by own Momence spots', twoPm?.[3].spotsLeft, 6);
check('no sold-out fallback when partners exist', twoPm?.some((o) => o.href === '#'), false);

console.log('Partner-less Open Hours slot keeps the sold-out 2hr fallback');
const noonFallback = opts('oh-1hr-noon')?.[1];
check('noon slot has two options', opts('oh-1hr-noon')?.length, 2);
check('fallback is sold out', noonFallback?.soldOut, true);
check('fallback minutes/credits', [noonFallback?.minutes, noonFallback?.credits], [120, 2]);

console.log('Bypass + non-pooled events');
check('high-capacity social not hidden', model.hiddenIds.has('social-bypass'), false);
check('high-capacity social sells own capacity', opts('social-bypass')?.[0].spotsLeft, 45);
check('guided session gets no options', opts('guided-7pm'), undefined);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll checks passed');
