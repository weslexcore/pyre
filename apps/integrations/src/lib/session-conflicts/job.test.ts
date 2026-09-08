import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MomenceEvent } from '@/lib/momence-events';
import { fakeDb } from './fake-db';

const sendTemplate = vi.fn();
const getDb = vi.fn();
const fetchMomenceEvents = vi.fn();
const listStaff = vi.fn();

vi.mock('@/lib/email/send', () => ({ sendTemplate: (args: unknown) => sendTemplate(args) }));
vi.mock('@/lib/db', () => ({ getDb: () => getDb() }));
vi.mock('@/lib/momence-events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/momence-events')>()),
  fetchMomenceEvents: () => fetchMomenceEvents(),
}));
vi.mock('@/lib/auth/access', () => ({ listStaff: () => listStaff() }));
vi.mock('@/lib/momence/host-api', () => ({ cancelRouteStatus: () => 'unknown' }));

const { buildEmailProps, runSessionConflictCheck } = await import('./job');

/** 8am EDT on Monday 2026-09-14 — inside the send window. */
const MONDAY_8AM_ET = new Date('2026-09-14T12:00:00Z');

const ctx = { dryRun: false, timeRemainingMs: () => 50_000 };

const et = (date: string, time: string): string =>
  new Date(`${date}T${time}:00-04:00`).toISOString();

let nextId = 100;
const event = (over: Partial<MomenceEvent> = {}): MomenceEvent => ({
  id: nextId++,
  title: 'Open Hours',
  tags: ['Open Hours'],
  dateTime: et('2026-09-17', '19:00'),
  duration: 60,
  location: 'Pyre Sauna',
  capacity: 10,
  spotsRemaining: 8,
  ...over,
});

const special = (over: Partial<MomenceEvent> = {}): MomenceEvent =>
  event({ id: 1, title: 'Sound Bath', tags: ['Special Event'], duration: 120, ...over });

const admins = [
  { id: 'a', display_name: 'Wes', email: 'wes@pyre.test', is_admin: true, active: true },
  { id: 'b', display_name: 'Sam', email: 'sam@pyre.test', is_admin: true, active: true },
  { id: 'c', display_name: 'Omar', email: 'omar@pyre.test', is_admin: false, active: true },
  { id: 'd', display_name: 'Ghost', email: null, is_admin: true, active: true },
];

describe('runSessionConflictCheck', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(MONDAY_8AM_ET);
    sendTemplate.mockReset().mockResolvedValue({ status: 'sent', id: 're_1' });
    getDb.mockReset();
    fetchMomenceEvents.mockReset().mockResolvedValue([special(), event(), event()]);
    listStaff.mockReset().mockResolvedValue(admins);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stays quiet on any day but Monday', async () => {
    vi.setSystemTime(new Date('2026-09-15T12:00:00Z'));
    const summary = await runSessionConflictCheck(ctx);
    expect(summary.skipped).toBe('not-monday');
    expect(fetchMomenceEvents).not.toHaveBeenCalled();
  });

  it('waits for the send hour on Monday', async () => {
    vi.setSystemTime(new Date('2026-09-14T09:30:00Z')); // 5:30am EDT
    expect((await runSessionConflictCheck(ctx)).skipped).toBe('before-send-hour');
  });

  it('reports the gate instead of obeying it on a dry run', async () => {
    vi.setSystemTime(new Date('2026-09-16T12:00:00Z'));
    const { db, inserts } = fakeDb();
    getDb.mockReturnValue(db);
    const summary = await runSessionConflictCheck({ ...ctx, dryRun: true });
    expect(summary.gate).toBe('would-skip:not-monday');
    expect(summary.sessions).toBe(2);
    expect(summary.wouldSend).toEqual(['wes@pyre.test', 'sam@pyre.test']);
    expect(summary.preview?.[0]?.sessionIds).toHaveLength(2);
    expect(inserts).toHaveLength(0);
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('says so when Supabase is down', async () => {
    getDb.mockReturnValue(null);
    expect((await runSessionConflictCheck(ctx)).skipped).toBe('db-unavailable');
  });

  it('writes a clear review and emails nobody when nothing overlaps', async () => {
    fetchMomenceEvents.mockResolvedValue([event(), event()]);
    const { db, inserts } = fakeDb();
    getDb.mockReturnValue(db);
    const summary = await runSessionConflictCheck(ctx);
    expect(summary.status).toBe('clear');
    expect(inserts[0]).toMatchObject({ status: 'clear', source: 'cron', session_count: 0 });
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('opens a pending review and emails each admin once, keyed per person', async () => {
    const { db, inserts, updates } = fakeDb([
      { id: 'old', status: 'pending', source: 'manual', week_start: '2026-09-07' },
    ]);
    getDb.mockReturnValue(db);

    const summary = await runSessionConflictCheck(ctx);

    expect(summary).toMatchObject({
      weekStart: '2026-09-14',
      status: 'pending',
      specialEvents: 1,
      sessions: 2,
      preselected: 2,
      sent: 2,
      duplicates: 0,
      failed: [],
    });
    expect(inserts[0]).toMatchObject({
      week_start: '2026-09-14',
      horizon_start: '2026-09-14',
      horizon_end: '2026-10-12',
      status: 'pending',
      source: 'cron',
      session_count: 2,
      created_by: 'cron',
    });
    // The stale manual review was superseded first.
    expect(updates[0]).toMatchObject({
      payload: { status: 'superseded' },
      filters: [{ op: 'eq', column: 'status', value: 'pending' }],
    });

    expect(sendTemplate).toHaveBeenCalledTimes(2);
    const calls = sendTemplate.mock.calls.map(([args]) => args);
    expect(calls.map((c) => c.to)).toEqual(['wes@pyre.test', 'sam@pyre.test']);
    expect(calls[0].template).toBe('session-conflicts');
    expect(calls[0].sendKey).toBe(`session-conflicts:${summary.reviewId}:wes@pyre.test`);
    expect(calls[1].sendKey).toBe(`session-conflicts:${summary.reviewId}:sam@pyre.test`);
    expect(calls[0].props).toMatchObject({
      sessionCount: 2,
      preselectedCount: 2,
      eventCount: 1,
      reviewUrl: 'https://pyre-integrations.vercel.app/admin/session-conflicts',
    });
    expect(calls[0].props.groups[0].eventTitle).toBe('Sound Bath');
    expect(calls[0].props.groups[0].sessions).toHaveLength(2);

    // notified_at bookkeeping.
    expect(updates.at(-1)?.payload).toMatchObject({ notified_count: 2 });
  });

  it('does not run twice in a week, but finishes an interrupted send', async () => {
    const existing = {
      id: 'r1',
      status: 'pending',
      source: 'cron',
      week_start: '2026-09-14',
      horizon_start: '2026-09-14',
      horizon_end: '2026-10-12',
      conflicts: [],
      resolution: {},
      notified_count: 1,
    };
    const { db, inserts } = fakeDb([existing]);
    getDb.mockReturnValue(db);
    sendTemplate
      .mockResolvedValueOnce({ status: 'skipped', reason: 'already-sent' })
      .mockResolvedValueOnce({ status: 'sent', id: 're_2' });

    const summary = await runSessionConflictCheck(ctx);

    expect(fetchMomenceEvents).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
    expect(summary).toMatchObject({ reviewId: 'r1', sent: 1, duplicates: 1 });

    // Once the review is closed, later ticks are no-ops.
    existing.status = 'resolved';
    const { db: closedDb } = fakeDb([existing]);
    getDb.mockReturnValue(closedDb);
    sendTemplate.mockClear();
    expect((await runSessionConflictCheck(ctx)).skipped).toBe('already-ran');
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it("carries on with the other tick's row when the weekly insert races", async () => {
    const { db } = fakeDb([], { insertError: { code: '23505', message: 'duplicate key' } });
    // After the failed insert, the re-read finds the row the other tick made.
    let reads = 0;
    const original = db.from;
    db.from = vi.fn((table: string) => {
      const chain = original(table);
      const select = chain.select;
      chain.select = () => {
        reads += 1;
        const b = select();
        if (reads >= 2) {
          b.maybeSingle = async () => ({
            data: {
              id: 'other',
              status: 'pending',
              source: 'cron',
              week_start: '2026-09-14',
              horizon_end: '2026-10-12',
              conflicts: [],
              resolution: {},
              notified_count: 0,
            },
            error: null,
          });
        }
        return b;
      };
      return chain;
    }) as typeof db.from;
    getDb.mockReturnValue(db);

    const summary = await runSessionConflictCheck(ctx);
    expect(summary.reviewId).toBe('other');
    expect(summary.sent).toBe(2);
  });

  it('lets a Momence outage surface as an error rather than an empty week', async () => {
    fetchMomenceEvents.mockRejectedValue(new Error('Momence Events API returned 502'));
    const { db, inserts } = fakeDb();
    getDb.mockReturnValue(db);
    await expect(runSessionConflictCheck(ctx)).rejects.toThrow('502');
    expect(inserts).toHaveLength(0);
  });

  it('stops sending when the tick is out of time and counts failures', async () => {
    const { db } = fakeDb();
    getDb.mockReturnValue(db);
    sendTemplate.mockRejectedValueOnce(new Error('Resend down'));
    let calls = 0;
    const tight = { dryRun: false, timeRemainingMs: () => (calls++ === 0 ? 50_000 : 1_000) };
    const summary = await runSessionConflictCheck(tight);
    expect(summary.failed).toEqual(['wes@pyre.test']);
    expect(summary.outOfTime).toBe(true);
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });
});

describe('buildEmailProps', () => {
  it('labels times in ET and links what has a link', () => {
    const props = buildEmailProps(
      {
        horizon_end: '2026-10-12',
        conflicts: [
          {
            specialEvent: {
              id: 1,
              title: 'Sound Bath',
              startsAt: et('2026-09-17', '19:00'),
              endsAt: et('2026-09-17', '21:00'),
              location: 'Pyre Sauna',
              link: 'https://momence.com/s/1',
            },
            sessions: [
              {
                id: 10,
                title: 'Open Hours',
                tag: 'Open Hours',
                type: 'open hours',
                startsAt: et('2026-09-17', '19:00'),
                endsAt: et('2026-09-17', '20:00'),
                location: null,
                bookingCount: 3,
                capacity: 10,
                link: null,
                preselected: true,
              },
              {
                id: 11,
                title: 'Guided Heat',
                tag: 'Guided',
                type: 'guided',
                startsAt: et('2026-09-17', '20:00'),
                endsAt: et('2026-09-17', '21:00'),
                location: null,
                bookingCount: null,
                capacity: null,
                link: null,
                preselected: false,
              },
            ],
          },
        ],
      },
      'https://example.test'
    );
    expect(props.horizonLabel).toBe('Oct 12');
    expect(props.sessionCount).toBe(2);
    expect(props.preselectedCount).toBe(1);
    expect(props.reviewUrl).toBe('https://example.test/admin/session-conflicts');
    expect(props.groups[0]).toMatchObject({
      eventTitle: 'Sound Bath',
      whenLabel: 'Thu, Sep 17 · 7:00 PM – 9:00 PM EDT',
      location: 'Pyre Sauna',
      link: 'https://momence.com/s/1',
    });
    expect(props.groups[0].sessions[0]).toEqual({
      title: 'Open Hours',
      whenLabel: 'Thu, Sep 17 · 7:00 PM – 8:00 PM EDT',
      typeLabel: 'Open hours',
      bookingLabel: '3 booked',
      preselected: true,
    });
    expect(props.groups[0].sessions[1].bookingLabel).toBe('');
    expect(props.cancelSupported).toBeUndefined();
  });
});
