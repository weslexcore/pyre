import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchHostSessions = vi.fn();
const fetchAppointmentReservations = vi.fn();
const getRedis = vi.fn();

vi.mock('@/lib/momence/host-api', () => ({
  fetchHostSessions: (args: unknown) => fetchHostSessions(args),
  fetchAppointmentReservations: (args: unknown) => fetchAppointmentReservations(args),
}));
vi.mock('@pyre/webhook-core', () => ({ getRedis: () => getRedis() }));

const { countSignups, fetchScheduleFeed, formatSignups } = await import('./signups');

const shift = (over: Partial<Parameters<typeof countSignups>[0][number]> = {}) => ({
  id: 'am',
  shift_date: '2026-09-05',
  starts_at: '08:00',
  ends_at: '13:00',
  status: 'active' as const,
  ...over,
});

// 12:00Z is 08:00 ET in September (EDT, UTC-4).
const session = (over: Partial<Parameters<typeof countSignups>[1][number]> = {}) => ({
  id: 1,
  name: 'Social sauna',
  startsAt: '2026-09-05T14:00:00.000Z',
  endsAt: '2026-09-05T15:30:00.000Z',
  isDraft: false,
  bookingCount: 4,
  ...over,
});

describe('countSignups', () => {
  it('sums live bookings across the sessions inside one shift', () => {
    const out = countSignups(
      [shift()],
      [
        session({ id: 1, startsAt: '2026-09-05T12:00:00.000Z', bookingCount: 3 }),
        session({ id: 2, startsAt: '2026-09-05T14:00:00.000Z', bookingCount: 5 }),
        session({ id: 3, startsAt: '2026-09-05T16:30:00.000Z', bookingCount: undefined }),
      ],
      []
    );
    expect(out).toEqual({ am: 8 });
  });

  it('gives every active shift an entry, zero when nothing is booked', () => {
    const out = countSignups(
      [shift({ id: 'am' }), shift({ id: 'pm', starts_at: '13:00', ends_at: '21:00' })],
      [session({ startsAt: '2026-09-05T12:00:00.000Z', bookingCount: 2 })],
      []
    );
    expect(out).toEqual({ am: 2, pm: 0 });
  });

  it('puts a session on the AM/PM boundary in the later shift only', () => {
    const out = countSignups(
      [shift({ id: 'am' }), shift({ id: 'pm', starts_at: '13:00', ends_at: '21:00' })],
      // 17:00Z = 13:00 ET
      [session({ startsAt: '2026-09-05T17:00:00.000Z', bookingCount: 6 })],
      []
    );
    expect(out).toEqual({ am: 0, pm: 6 });
  });

  it('buckets by the ET date, not the UTC date', () => {
    const out = countSignups(
      [shift({ id: 'sat-pm', shift_date: '2026-09-05', starts_at: '17:00', ends_at: '23:59' })],
      // 01:00Z Sunday = 21:00 ET Saturday
      [session({ startsAt: '2026-09-06T01:00:00.000Z', bookingCount: 7 })],
      []
    );
    expect(out).toEqual({ 'sat-pm': 7 });
  });

  it('ignores sessions on another day or outside every window', () => {
    const out = countSignups(
      [shift()],
      [
        session({ startsAt: '2026-09-06T12:00:00.000Z', bookingCount: 9 }),
        // 22:00Z = 18:00 ET, after the 13:00 close of the AM shift
        session({ startsAt: '2026-09-05T22:00:00.000Z', bookingCount: 9 }),
      ],
      []
    );
    expect(out).toEqual({ am: 0 });
  });

  it('counts each appointment reservation as one guest', () => {
    const out = countSignups(
      [shift()],
      [session({ startsAt: '2026-09-05T12:00:00.000Z', bookingCount: 1 })],
      [
        { id: 10, startsAt: '2026-09-05T13:00:00.000Z', endsAt: null },
        { id: 11, startsAt: '2026-09-05T15:00:00.000Z', endsAt: null },
        { id: 12, startsAt: '2026-09-05T22:00:00.000Z', endsAt: null },
      ]
    );
    expect(out).toEqual({ am: 3 });
  });

  it('skips cancelled shifts entirely', () => {
    const out = countSignups(
      [shift({ id: 'gone', status: 'cancelled' }), shift({ id: 'am' })],
      [session({ startsAt: '2026-09-05T12:00:00.000Z', bookingCount: 2 })],
      []
    );
    expect(out).toEqual({ am: 2 });
  });
});

describe('formatSignups', () => {
  it('pluralises', () => {
    expect(formatSignups(0)).toBe('0 signups');
    expect(formatSignups(1)).toBe('1 signup');
    expect(formatSignups(12)).toBe('12 signups');
  });
});

describe('fetchScheduleFeed', () => {
  beforeEach(() => {
    fetchHostSessions.mockReset().mockResolvedValue([session()]);
    fetchAppointmentReservations.mockReset().mockResolvedValue([]);
    getRedis.mockReset().mockReturnValue(null);
  });
  afterEach(() => {
    vi.resetModules();
  });

  it('pads the ET range by a day either side in UTC', async () => {
    const feed = await fetchScheduleFeed('2026-09-07', '2026-09-13');
    expect(feed.sessions).toHaveLength(1);
    expect(fetchHostSessions).toHaveBeenCalledWith({
      startAfter: '2026-09-06T00:00:00.000Z',
      startBefore: '2026-09-15T00:00:00.000Z',
    });
    expect(fetchAppointmentReservations).toHaveBeenCalledWith({
      startAfter: '2026-09-06T00:00:00.000Z',
      startBefore: '2026-09-15T00:00:00.000Z',
    });
  });
});
