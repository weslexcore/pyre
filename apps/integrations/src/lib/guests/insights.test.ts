import { describe, expect, it } from 'vitest';
import type { BoughtMembership } from '@/lib/momence/host-api';
import {
  classifySessionName,
  type HistoryEntry,
  habitLine,
  membershipStanding,
  normalizeHistoryEntry,
  summarizeHistory,
  summarizePack,
} from './insights';

// Tuesday 2026-09-01 22:00Z = 6pm ET (EDT); Saturday 2026-09-05 13:00Z = 9am ET.
const TUE_EVENING = '2026-09-01T22:00:00.000Z';
const SAT_MORNING = '2026-09-05T13:00:00.000Z';
const NOW = Date.parse('2026-09-10T12:00:00.000Z');

const entry = (over: Partial<HistoryEntry>): HistoryEntry => ({
  name: 'Social Sauna',
  startsAt: TUE_EVENING,
  checkedIn: true,
  cancelled: false,
  ...over,
});

describe('normalizeHistoryEntry', () => {
  it('reads whichever shape Momence used for the session', () => {
    expect(
      normalizeHistoryEntry({ session: { title: 'Silent Sauna', startDate: TUE_EVENING } })
    ).toEqual({ name: 'Silent Sauna', startsAt: TUE_EVENING, checkedIn: false, cancelled: false });
    expect(
      normalizeHistoryEntry({
        name: 'Guided',
        startsAt: TUE_EVENING,
        attended: true,
        cancelledAt: '2026-08-30T00:00:00Z',
      })
    ).toMatchObject({ checkedIn: true, cancelled: true });
  });

  it('drops a row with no usable start time', () => {
    expect(normalizeHistoryEntry({ name: 'Mystery' })).toBeNull();
    expect(normalizeHistoryEntry({ name: 'Mystery', startsAt: 'yesterday' })).toBeNull();
  });
});

describe('classifySessionName', () => {
  it('names the type staff would', () => {
    expect(classifySessionName('Silent Sauna — Evening')).toBe('Silent');
    expect(classifySessionName('Social Sauna')).toBe('Social');
    expect(classifySessionName('Guided Sound Bath')).toBe('Guided');
    expect(classifySessionName('Open Hours')).toBe('Open hours');
    expect(classifySessionName('Full Moon Gathering')).toBe('Other');
  });
});

describe('summarizeHistory', () => {
  it('counts attendance by type and spots the habit', () => {
    const summary = summarizeHistory(
      [
        entry({}),
        entry({ startsAt: '2026-08-25T22:00:00.000Z' }),
        entry({ startsAt: '2026-08-18T22:00:00.000Z', name: 'Silent Sauna' }),
        entry({ startsAt: SAT_MORNING, name: 'Guided Sauna', checkedIn: false }),
        entry({ cancelled: true, name: 'Yoga' }),
        // Upcoming: a plan, not a pattern.
        entry({ startsAt: '2026-09-15T22:00:00.000Z' }),
      ],
      NOW
    );
    expect(summary.booked).toBe(5);
    expect(summary.attended).toBe(3);
    expect(summary.byType).toEqual([
      { type: 'Social', count: 2 },
      { type: 'Silent', count: 1 },
    ]);
    expect(summary.favouriteType).toBe('Social');
    expect(summary.favouriteDay).toBe('Tuesday');
    expect(summary.favouriteTimeOfDay).toBe('evenings');
    expect(summary.recent[0].startsAt).toBe('2026-09-15T22:00:00.000Z');
    expect(summary.recent.find((r) => r.name === 'Yoga')).toBeUndefined();
  });

  it('falls back to bookings when Momence carries no check-in data at all', () => {
    const summary = summarizeHistory(
      [entry({ checkedIn: false }), entry({ checkedIn: false, name: 'Silent Sauna' })],
      NOW
    );
    expect(summary.attended).toBe(0);
    expect(summary.byType.map((b) => b.count)).toEqual([1, 1]);
  });

  it('names no favourite from a single visit or an even split', () => {
    expect(summarizeHistory([entry({})], NOW).favouriteDay).toBeNull();
    const split = summarizeHistory(
      [entry({}), entry({ startsAt: SAT_MORNING, name: 'Guided' })],
      NOW
    );
    expect(split.favouriteDay).toBeNull();
    expect(split.favouriteTimeOfDay).toBeNull();
  });

  it('writes the habit line staff read', () => {
    expect(habitLine({ favouriteDay: 'Tuesday', favouriteTimeOfDay: 'evenings' })).toBe(
      'Usually Tuesday evenings'
    );
    expect(habitLine({ favouriteDay: null, favouriteTimeOfDay: 'mornings' })).toBe(
      'Usually mornings'
    );
    expect(habitLine({ favouriteDay: null, favouriteTimeOfDay: null })).toBeNull();
  });
});

describe('membership standing', () => {
  const pack = (over: Partial<BoughtMembership>): BoughtMembership => ({
    id: 1,
    type: 'package-events',
    startDate: null,
    endDate: null,
    isFrozen: false,
    eventCreditsLeft: 3,
    eventCreditsTotal: 5,
    moneyCreditsLeft: null,
    moneyCreditsTotal: null,
    membership: { id: 9, name: 'Five Pack' },
    ...over,
  });

  it('a frozen subscription is still a member; a credit pack is a pack', () => {
    expect(
      membershipStanding([summarizePack(pack({ type: 'subscription', isFrozen: true }))])
    ).toBe('member');
    expect(membershipStanding([summarizePack(pack({}))])).toBe('pack');
    expect(membershipStanding([])).toBe('none');
  });

  it('carries the pack name and credits through', () => {
    expect(summarizePack(pack({}))).toMatchObject({
      name: 'Five Pack',
      recurring: false,
      creditsLeft: 3,
      creditsTotal: 5,
    });
  });
});
