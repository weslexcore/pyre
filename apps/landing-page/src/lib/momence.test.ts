// Which events each surface sees. The public list is upcoming-only; the admin
// pickers ask for past events too, so a campaign built for an event can keep
// naming that event once the date has passed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  filterPublishedEvents,
  filterValidEvents,
  sortEventsUpcomingFirst,
} from '@/lib/momence';
import type { MomenceEvent } from '@/lib/momence-types';

const NOW = new Date('2026-06-15T12:00:00Z');

// `filterValidEvents` reads the clock itself, so pin it.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function event(id: number, dateTime: string, extra: Partial<MomenceEvent> = {}): MomenceEvent {
  return {
    id,
    title: `Event ${id}`,
    dateTime,
    isCancelled: false,
    isDeleted: false,
    published: true,
    ...extra,
  } as MomenceEvent;
}

const PAST = event(1, '2026-01-10T18:00:00Z');
const SOON = event(2, '2026-07-01T18:00:00Z');
const LATER = event(3, '2026-09-01T18:00:00Z');
const RECENT_PAST = event(4, '2026-06-01T18:00:00Z');

describe('filterPublishedEvents', () => {
  it('keeps events that have already happened', () => {
    expect(filterPublishedEvents([PAST, SOON]).map((e) => e.id)).toEqual([1, 2]);
  });

  it('still drops cancelled, deleted and unpublished events', () => {
    const dropped = [
      event(10, '2026-07-01T18:00:00Z', { isCancelled: true }),
      event(11, '2026-07-01T18:00:00Z', { isDeleted: true }),
      event(12, '2026-07-01T18:00:00Z', { published: false }),
    ];
    expect(filterPublishedEvents([...dropped, SOON]).map((e) => e.id)).toEqual([2]);
  });
});

describe('filterValidEvents', () => {
  it('drops past events, as the public list always has', () => {
    const kept = filterValidEvents([PAST, SOON, LATER]).map((e) => e.id);
    expect(kept).not.toContain(1);
    expect(kept).toEqual([2, 3]);
  });

  it('keeps an event whose date will not parse rather than calling it over', () => {
    expect(filterValidEvents([event(9, 'not-a-date')]).map((e) => e.id)).toEqual([9]);
  });
});

describe('sortEventsUpcomingFirst', () => {
  it('puts what is coming up first, then what has passed, most recent first', () => {
    const ordered = sortEventsUpcomingFirst([PAST, LATER, RECENT_PAST, SOON], NOW);
    expect(ordered.map((e) => e.id)).toEqual([2, 3, 4, 1]);
  });
});
