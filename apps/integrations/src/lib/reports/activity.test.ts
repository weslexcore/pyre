import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchHostSessions = vi.fn();
const fetchSessionBookings = vi.fn();
const fetchMembersFiltered = vi.fn();
const fetchMemberActivePacks = vi.fn();
const getIntroOfferMembershipIds = vi.fn();
const getDb = vi.fn();
const getRedis = vi.fn();

vi.mock('@/lib/momence/host-api', () => ({
  fetchHostSessions: (args: unknown) => fetchHostSessions(args),
  fetchSessionBookings: (id: number) => fetchSessionBookings(id),
  fetchMembersFiltered: (args: unknown) => fetchMembersFiltered(args),
  fetchMemberActivePacks: (id: number, opts: unknown) => fetchMemberActivePacks(id, opts),
  getIntroOfferMembershipIds: () => getIntroOfferMembershipIds(),
}));
vi.mock('@/lib/db', () => ({ getDb: () => getDb() }));
vi.mock('@pyre/webhook-core', () => ({ getRedis: () => getRedis() }));

const { runActivityMetricsSync } = await import('./activity');

/** Thursday 2026-08-20, 10am EDT — after the 6am sync hour. */
const NOW = new Date('2026-08-20T14:00:00Z');

/** The completed week under test: Mon 2026-08-10 .. Sun 2026-08-16. */
const LAST_WEEK = '2026-08-10';
const THIS_WEEK = '2026-08-17';
/** ET day of the default session below (2026-08-12T20:00Z = 4pm EDT Wed). */
const SESSION_DAY = '2026-08-12';

const ctx = { dryRun: false, timeRemainingMs: () => 50_000 };

const session = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Open Hours',
  startsAt: '2026-08-12T20:00:00.000Z',
  endsAt: '2026-08-12T21:00:00.000Z',
  isDraft: false,
  isCancelled: false,
  capacity: 30,
  bookingCount: 2,
  ...over,
});

const booking = (over: Record<string, unknown> = {}) => ({
  id: 100,
  checkedIn: true,
  ticketsBought: 1,
  cancelledAt: null,
  ...over,
});

/** Captures every business_metrics_daily upsert, keyed date|metric. */
function fakeDb(existingMetricRows: unknown[] = []) {
  const upserts: Record<string, number> = {};
  const db = {
    from(_table: string) {
      const result = { data: existingMetricRows, error: null };
      const builder: Record<string, unknown> = {
        // biome-ignore lint/suspicious/noThenProperty: the Supabase builder is thenable, so the fake must be too
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
        upsert: (rows: Array<Record<string, unknown>>) => {
          for (const row of rows) {
            upserts[`${row.metric_date}|${row.metric}`] = row.value as number;
          }
          return Promise.resolve({ error: null });
        },
      };
      for (const method of ['select', 'gte', 'lte', 'eq', 'in']) {
        builder[method] = () => builder;
      }
      return builder;
    },
  };
  return { db, upserts };
}

function fakeRedis() {
  const store = new Map<string, unknown>();
  return {
    store,
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      store.set(key, value);
    },
    del: async (key: string) => {
      store.delete(key);
    },
  };
}

describe('runActivityMetricsSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    fetchHostSessions.mockReset().mockResolvedValue([]);
    fetchSessionBookings.mockReset().mockResolvedValue([]);
    fetchMembersFiltered.mockReset().mockResolvedValue({ members: [], totalCount: 0 });
    fetchMemberActivePacks.mockReset().mockResolvedValue([]);
    getIntroOfferMembershipIds.mockReset().mockReturnValue([]);
    getDb.mockReset();
    getRedis.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts check-ins as attendance and uncheck-ins as no-shows, per ET day', async () => {
    const { db, upserts } = fakeDb();
    getDb.mockReturnValue(db);
    getRedis.mockReturnValue(fakeRedis());
    fetchHostSessions.mockImplementation(async ({ startAfter }: { startAfter: string }) =>
      startAfter.startsWith('2026-08-09') ? [session({ bookingCount: 3 })] : []
    );
    fetchSessionBookings.mockResolvedValue([
      booking({ id: 1, checkedIn: true }),
      booking({ id: 2, checkedIn: true }),
      booking({ id: 3, checkedIn: false }),
    ]);

    const summary = await runActivityMetricsSync(ctx, { weeksBack: 1 });

    expect(summary.skipped).toBeUndefined();
    expect(upserts[`${SESSION_DAY}|attendance`]).toBe(2);
    expect(upserts[`${SESSION_DAY}|no_shows`]).toBe(1);
  });

  it('ignores cancelled bookings and counts multi-ticket bookings per seat', async () => {
    const { db, upserts } = fakeDb();
    getDb.mockReturnValue(db);
    getRedis.mockReturnValue(fakeRedis());
    fetchHostSessions.mockImplementation(async ({ startAfter }: { startAfter: string }) =>
      startAfter.startsWith('2026-08-09') ? [session({ bookingCount: 2 })] : []
    );
    fetchSessionBookings.mockResolvedValue([
      booking({ id: 1, checkedIn: true, ticketsBought: 2 }),
      booking({ id: 2, checkedIn: true, cancelledAt: '2026-08-11T00:00:00.000Z' }),
      booking({ id: 3, checkedIn: false, ticketsBought: 3 }),
    ]);

    await runActivityMetricsSync(ctx, { weeksBack: 1 });

    expect(upserts[`${SESSION_DAY}|attendance`]).toBe(2);
    expect(upserts[`${SESSION_DAY}|no_shows`]).toBe(3);
  });

  it('writes raw capacity and booked counts summed across a day', async () => {
    const { db, upserts } = fakeDb();
    getDb.mockReturnValue(db);
    getRedis.mockReturnValue(fakeRedis());
    fetchHostSessions.mockImplementation(async ({ startAfter }: { startAfter: string }) =>
      startAfter.startsWith('2026-08-09')
        ? [
            session({ id: 1, capacity: 30, bookingCount: 6 }),
            session({ id: 2, capacity: 10, bookingCount: 2 }),
          ]
        : []
    );

    await runActivityMetricsSync(ctx, { weeksBack: 1 });

    // The raw numerator/denominator, so read-time grouping computes true
    // occupancy (8/40) instead of averaging percentages.
    expect(upserts[`${SESSION_DAY}|session_capacity`]).toBe(40);
    expect(upserts[`${SESSION_DAY}|session_booked`]).toBe(8);
  });

  it('drops sessions the padded fetch pulled in from an adjacent week', async () => {
    const { db, upserts } = fakeDb();
    getDb.mockReturnValue(db);
    getRedis.mockReturnValue(fakeRedis());
    fetchHostSessions.mockImplementation(async ({ startAfter }: { startAfter: string }) =>
      startAfter.startsWith('2026-08-09')
        ? [
            session({ id: 1, capacity: 10, bookingCount: 5 }),
            // Sunday 2026-08-09 ET — the previous week, inside the pad.
            session({
              id: 2,
              startsAt: '2026-08-09T20:00:00.000Z',
              endsAt: '2026-08-09T21:00:00.000Z',
              capacity: 90,
              bookingCount: 0,
            }),
          ]
        : []
    );

    await runActivityMetricsSync(ctx, { weeksBack: 1 });

    expect(upserts[`${SESSION_DAY}|session_capacity`]).toBe(10);
    expect(upserts[`${SESSION_DAY}|session_booked`]).toBe(5);
    expect(upserts['2026-08-09|session_capacity']).toBeUndefined();
  });

  it('buckets a late-evening ET session by its ET day, not its UTC day', async () => {
    const { db, upserts } = fakeDb();
    getDb.mockReturnValue(db);
    getRedis.mockReturnValue(fakeRedis());
    // 2026-08-17T01:00Z is 9pm ET on Sunday 2026-08-16 — still LAST_WEEK.
    fetchHostSessions.mockImplementation(async ({ startAfter }: { startAfter: string }) =>
      startAfter.startsWith('2026-08-09')
        ? [
            session({
              startsAt: '2026-08-17T01:00:00.000Z',
              endsAt: '2026-08-17T02:00:00.000Z',
              capacity: 10,
              bookingCount: 4,
            }),
          ]
        : []
    );

    await runActivityMetricsSync(ctx, { weeksBack: 1 });

    expect(upserts['2026-08-16|session_capacity']).toBe(10);
    expect(upserts['2026-08-16|session_booked']).toBe(4);
    expect(upserts['2026-08-17|session_capacity']).toBeUndefined();
  });

  it('skips the bookings request for sessions nobody booked', async () => {
    const { db } = fakeDb();
    getDb.mockReturnValue(db);
    getRedis.mockReturnValue(fakeRedis());
    fetchHostSessions.mockImplementation(async ({ startAfter }: { startAfter: string }) =>
      startAfter.startsWith('2026-08-09')
        ? [session({ id: 1, bookingCount: 0 }), session({ id: 2, bookingCount: 1 })]
        : []
    );

    await runActivityMetricsSync(ctx, { weeksBack: 1 });

    expect(fetchSessionBookings).toHaveBeenCalledTimes(1);
    expect(fetchSessionBookings).toHaveBeenCalledWith(2);
  });

  it('leaves attendance unwritten for days whose sessions have not started', async () => {
    const { db, upserts } = fakeDb();
    getDb.mockReturnValue(db);
    getRedis.mockReturnValue(fakeRedis());
    // The in-progress week: one session still ahead of NOW.
    fetchHostSessions.mockImplementation(async ({ startAfter }: { startAfter: string }) =>
      startAfter.startsWith('2026-08-16')
        ? [
            session({
              id: 9,
              startsAt: '2026-08-25T20:00:00.000Z',
              endsAt: '2026-08-25T21:00:00.000Z',
              capacity: 30,
              bookingCount: 4,
            }),
          ]
        : []
    );

    await runActivityMetricsSync(ctx, { weeksBack: 0 });

    // Future session: no occupancy inputs, no attendance, no bookings request.
    expect(upserts['2026-08-25|attendance']).toBeUndefined();
    expect(upserts['2026-08-25|session_capacity']).toBeUndefined();
    expect(fetchSessionBookings).not.toHaveBeenCalled();
  });

  it('buckets new members by ET day and zero-fills quiet days', async () => {
    const { db, upserts } = fakeDb();
    getDb.mockReturnValue(db);
    getRedis.mockReturnValue(fakeRedis());
    fetchMembersFiltered.mockImplementation(async (args: { filterPreset?: string }) => {
      if (args.filterPreset === 'with-active-membership') {
        return { members: [], totalCount: 0 };
      }
      return {
        members: [
          { id: 1, firstSeen: '2026-08-18T15:00:00.000Z' }, // Tuesday this week
          { id: 2, firstSeen: '2026-08-12T15:00:00.000Z' }, // last week
          { id: 3, firstSeen: '2026-08-17T01:00:00.000Z' }, // 9pm ET Sun — 08-16
        ],
        totalCount: 3,
      };
    });

    await runActivityMetricsSync(ctx, { weeksBack: 1 });

    expect(upserts['2026-08-18|new_members']).toBe(1);
    expect(upserts['2026-08-12|new_members']).toBe(1);
    expect(upserts['2026-08-16|new_members']).toBe(1);
    // A day with no arrivals is a real 0, not a gap.
    expect(upserts['2026-08-11|new_members']).toBe(0);
  });

  // --- active_members: Momence's own filter over-counts, so it is narrowed ---

  /** Momence says these five hold an "active membership". */
  const withActiveMembership = (ids: number[]) => {
    fetchMembersFiltered.mockImplementation(async (args: { filterPreset?: string }) => {
      if (args.filterPreset === 'with-active-membership') {
        return { members: ids.map((id) => ({ id })), totalCount: ids.length };
      }
      return { members: [], totalCount: 0 };
    });
  };

  const pack = (over: Record<string, unknown> = {}) => ({
    id: 1,
    type: 'subscription',
    startDate: null,
    endDate: null,
    isFrozen: false,
    eventCreditsLeft: null,
    eventCreditsTotal: null,
    moneyCreditsLeft: null,
    moneyCreditsTotal: null,
    membership: null,
    ...over,
  });

  it('counts only recurring plans, not intro packages or credit packs', async () => {
    const { db, upserts } = fakeDb();
    getDb.mockReturnValue(db);
    getRedis.mockReturnValue(fakeRedis());
    getIntroOfferMembershipIds.mockReturnValue([77]);
    withActiveMembership([1, 2, 3, 4, 5]);
    fetchMemberActivePacks.mockImplementation(async (id: number) => {
      if (id === 1) return [pack()]; // a real monthly subscription
      if (id === 2) return [pack({ type: 'package-events', eventCreditsLeft: 4 })]; // credit pack
      if (id === 3) return [pack({ type: 'package-money', moneyCreditsLeft: 50 })]; // stored value
      if (id === 4) return [pack({ membership: { id: 77, name: 'Intro Offer' } })]; // intro
      return [pack({ isFrozen: true })]; // paused, so not paying this month
    });

    await runActivityMetricsSync(ctx, { weeksBack: 1 });

    // Momence would have said 5.
    expect(upserts['2026-08-20|active_members']).toBe(1);
  });

  it('counts a member once when they hold a pack alongside a subscription', async () => {
    const { db, upserts } = fakeDb();
    getDb.mockReturnValue(db);
    getRedis.mockReturnValue(fakeRedis());
    withActiveMembership([1]);
    fetchMemberActivePacks.mockResolvedValue([
      pack({ id: 1, type: 'package-events' }),
      pack({ id: 2, type: 'subscription' }),
    ]);

    await runActivityMetricsSync(ctx, { weeksBack: 1 });

    expect(upserts['2026-08-20|active_members']).toBe(1);
  });

  it('reads packs fresh so a cancellation cannot linger in the cache', async () => {
    const { db } = fakeDb();
    getDb.mockReturnValue(db);
    getRedis.mockReturnValue(fakeRedis());
    withActiveMembership([1]);

    await runActivityMetricsSync(ctx, { weeksBack: 1 });

    expect(fetchMemberActivePacks).toHaveBeenCalledWith(1, { fresh: true });
  });

  it('parks a half-finished count rather than writing a membership collapse', async () => {
    const { db, upserts } = fakeDb();
    getDb.mockReturnValue(db);
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);
    withActiveMembership([1, 2, 3]);
    // Enough budget for the first member, then nothing.
    let calls = 0;
    const tightCtx = {
      dryRun: false,
      timeRemainingMs: () => (calls++ < 1 ? 50_000 : 1_000),
    };

    const summary = await runActivityMetricsSync(tightCtx, { weeksBack: 1 });

    expect(summary.outOfTime).toBe(true);
    expect(summary.pendingMembers).toBeGreaterThan(0);
    expect(upserts['2026-08-20|active_members']).toBeUndefined();
    expect(redis.store.get('activity-sync:cursor')).toMatchObject({
      members: { recurring: expect.any(Number) },
    });
  });

  it('finishes a parked count on the next tick and writes it once', async () => {
    const { db, upserts } = fakeDb();
    getDb.mockReturnValue(db);
    const redis = fakeRedis();
    redis.store.set('activity-sync:cursor', {
      date: '2026-08-20',
      weeks: [],
      members: { pending: [7, 8], recurring: 3 },
    });
    getRedis.mockReturnValue(redis);
    fetchMemberActivePacks.mockResolvedValue([pack()]);

    const summary = await runActivityMetricsSync(ctx);

    expect(summary.resumed).toBe(true);
    expect(summary.membersClassified).toBe(2);
    // 3 carried over + the 2 finished here.
    expect(upserts['2026-08-20|active_members']).toBe(5);
    expect(redis.store.get('activity-sync:cursor')).toBeUndefined();
  });

  it('parks unscanned weeks in a cursor when the budget runs out', async () => {
    const { db } = fakeDb();
    getDb.mockReturnValue(db);
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);
    fetchHostSessions.mockResolvedValue([]);

    const summary = await runActivityMetricsSync(
      { dryRun: false, timeRemainingMs: () => 1_000 },
      { weeksBack: 4 }
    );

    expect(summary.outOfTime).toBe(true);
    expect(summary.weeksProcessed).toBe(0);
    expect(summary.pendingWeeks).toBe(5);
    expect(redis.store.get('activity-sync:cursor')).toMatchObject({ date: '2026-08-20' });
  });

  it('resumes a parked cursor without rebuilding the work list', async () => {
    const { db } = fakeDb();
    getDb.mockReturnValue(db);
    const redis = fakeRedis();
    redis.store.set('activity-sync:cursor', { date: '2026-08-20', weeks: [LAST_WEEK] });
    getRedis.mockReturnValue(redis);
    fetchHostSessions.mockResolvedValue([]);

    const summary = await runActivityMetricsSync(ctx);

    expect(summary.resumed).toBe(true);
    expect(summary.weeksProcessed).toBe(1);
    expect(summary.pendingWeeks).toBe(0);
    // Member metrics belong to the day's opening pass, not to a resume.
    expect(fetchMembersFiltered).not.toHaveBeenCalled();
    expect(redis.store.has('activity-sync:cursor')).toBe(false);
    expect(redis.store.has('activity-sync:done:2026-08-20')).toBe(true);
  });

  it('re-scans recent weeks daily but leaves settled weeks alone', async () => {
    // Every week in the window already has attendance day-rows from yesterday
    // (one row on its Monday is enough to mark the week scanned).
    const weeks = [
      '2026-06-29',
      '2026-07-06',
      '2026-07-13',
      '2026-07-20',
      '2026-07-27',
      '2026-08-03',
      LAST_WEEK,
      THIS_WEEK,
    ];
    const { db } = fakeDb(
      weeks.map((metric_date) => ({ metric_date, snapshot_date: '2026-08-19' }))
    );
    getDb.mockReturnValue(db);
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);
    fetchHostSessions.mockResolvedValue([]);

    const summary = await runActivityMetricsSync(ctx, { weeksBack: 7 });

    // The in-progress week plus the two completed weeks behind it; the four
    // older weeks already have rows and are left alone.
    expect(summary.weeksProcessed).toBe(3);
  });

  it('holds off before the sync hour and after the day is done', async () => {
    const { db } = fakeDb();
    getDb.mockReturnValue(db);
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);

    vi.setSystemTime(new Date('2026-08-20T08:00:00Z')); // 4am ET
    expect((await runActivityMetricsSync(ctx)).skipped).toBe('before-sync-hour');

    vi.setSystemTime(NOW);
    redis.store.set('activity-sync:done:2026-08-20', { finishedAt: 'x' });
    expect((await runActivityMetricsSync(ctx)).skipped).toBe('already-done');
  });

  it('writes nothing on a dry run', async () => {
    const { db, upserts } = fakeDb();
    getDb.mockReturnValue(db);
    getRedis.mockReturnValue(fakeRedis());

    const summary = await runActivityMetricsSync({ ...ctx, dryRun: true }, { weeksBack: 2 });

    expect(summary.wouldScan).toBe(3);
    expect(upserts).toEqual({});
    expect(fetchHostSessions).not.toHaveBeenCalled();
    expect(fetchMembersFiltered).not.toHaveBeenCalled();
  });
});
