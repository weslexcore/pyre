import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MomenceEvent } from '@/lib/momence-events';

const sendTemplate = vi.fn();
const fetchMomenceEvents = vi.fn();
const listStaff = vi.fn();

/** In-memory stand-in for the Upstash client: get/set/del over a Map. */
const store = new Map<string, unknown>();
const fakeRedis = {
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  set: vi.fn(async (key: string, value: unknown) => {
    store.set(key, value);
    return 'OK';
  }),
  del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
};
let redisAvailable = true;

vi.mock('@/lib/email/send', () => ({ sendTemplate: (args: unknown) => sendTemplate(args) }));
vi.mock('@/lib/momence-events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/momence-events')>()),
  fetchMomenceEvents: () => fetchMomenceEvents(),
}));
vi.mock('@/lib/auth/access', () => ({ listStaff: () => listStaff() }));
vi.mock('@pyre/webhook-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pyre/webhook-core')>()),
  getRedis: () => (redisAvailable ? fakeRedis : null),
}));

const { runScheduleLint } = await import('./job');
const { DIRTY_KEY } = await import('./trigger');

/** 8am EDT on Monday 2026-09-14 — past the 6am sync hour. */
const MONDAY_8AM_ET = new Date('2026-09-14T12:00:00Z');
const DONE_KEY = 'schedule-lint:done:2026-09-14';

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

/** Open Hours far enough out that horizon-short stays quiet. */
const farOut = () => event({ id: 99, dateTime: et('2026-10-09', '19:00') });

const admins = [
  { id: 'a', display_name: 'Wes', email: 'wes@pyre.test', is_admin: true, active: true },
  { id: 'b', display_name: 'Sam', email: 'sam@pyre.test', is_admin: true, active: true },
  { id: 'c', display_name: 'Omar', email: 'omar@pyre.test', is_admin: false, active: true },
  { id: 'd', display_name: 'Ghost', email: null, is_admin: true, active: true },
];

const sendKeys = () => sendTemplate.mock.calls.map(([args]) => args.sendKey as string);

describe('runScheduleLint', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(MONDAY_8AM_ET);
    store.clear();
    redisAvailable = true;
    sendTemplate.mockReset().mockResolvedValue({ status: 'sent', id: 're_1' });
    fetchMomenceEvents
      .mockReset()
      .mockResolvedValue([
        special(),
        event(),
        event({ dateTime: et('2026-09-17', '20:00') }),
        farOut(),
      ]);
    listStaff.mockReset().mockResolvedValue(admins);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('the gate', () => {
    it('waits for the sync hour', async () => {
      vi.setSystemTime(new Date('2026-09-14T09:30:00Z')); // 5:30am EDT
      expect((await runScheduleLint(ctx)).skipped).toBe('before-sync-hour');
      expect(fetchMomenceEvents).not.toHaveBeenCalled();
    });

    it('runs once a day, then reports already-done', async () => {
      const first = await runScheduleLint(ctx);
      expect(first.trigger).toBe('daily');
      expect(first.skipped).toBeUndefined();
      expect(store.get(DONE_KEY)).toBeTruthy();

      const second = await runScheduleLint(ctx);
      expect(second.skipped).toBe('already-done');
      expect(fetchMomenceEvents).toHaveBeenCalledTimes(1);
    });

    it('runs at any hour when the dirty flag is set, and clears it', async () => {
      vi.setSystemTime(new Date('2026-09-14T09:30:00Z'));
      store.set(DIRTY_KEY, { reason: 'session-created', at: 'x' });
      const summary = await runScheduleLint(ctx);
      expect(summary.trigger).toBe('dirty');
      expect(summary.findings).toBe(2);
      expect(store.has(DIRTY_KEY)).toBe(false);
    });

    it('ignores the gate when forced', async () => {
      store.set(DONE_KEY, { finishedAt: 'x' });
      const summary = await runScheduleLint({ ...ctx, force: true });
      expect(summary.trigger).toBe('forced');
      expect(summary.findings).toBe(2);
    });

    it('says so when Redis is down', async () => {
      redisAvailable = false;
      expect((await runScheduleLint(ctx)).skipped).toBe('redis-unavailable');
      // …unless forced, since the force came from something that already debounced.
      expect((await runScheduleLint({ ...ctx, force: true })).findings).toBe(2);
    });
  });

  it('reports the findings and who would be emailed on a dry run, touching nothing', async () => {
    vi.setSystemTime(new Date('2026-09-14T09:30:00Z'));
    const summary = await runScheduleLint({ ...ctx, dryRun: true });
    expect(summary).toMatchObject({
      trigger: 'dry-run',
      findings: 2,
      byRule: { 'special-event-overlap': 2 },
      bySeverity: { cancel: 2, fix: 0, notice: 0 },
      wouldSend: ['wes@pyre.test', 'sam@pyre.test'],
    });
    expect(summary.digest).toMatch(/^[0-9a-f]{12}$/);
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it('emails nobody when the schedule is clean, but still marks the day done', async () => {
    fetchMomenceEvents.mockResolvedValue([
      event(),
      event({ dateTime: et('2026-09-17', '20:00') }),
      farOut(),
    ]);
    const summary = await runScheduleLint(ctx);
    expect(summary.findings).toBe(0);
    expect(summary.sent).toBe(0);
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(store.get(DONE_KEY)).toBeTruthy();
  });

  it('emails every admin under a key of week, digest, and address', async () => {
    const summary = await runScheduleLint(ctx);
    expect(summary.sent).toBe(2);
    expect(sendKeys()).toEqual([
      `schedule-lint:2026-09-14:${summary.digest}:wes@pyre.test`,
      `schedule-lint:2026-09-14:${summary.digest}:sam@pyre.test`,
    ]);
    const [args] = sendTemplate.mock.calls[0];
    expect(args).toMatchObject({
      to: 'wes@pyre.test',
      template: 'schedule-lint',
      kind: 'transactional',
      props: expect.objectContaining({ cancelCount: 2, overlaps: [expect.anything()] }),
    });
  });

  it('counts the send log turning the same list away', async () => {
    sendTemplate.mockResolvedValue({ status: 'skipped', reason: 'already-sent' });
    const summary = await runScheduleLint({ ...ctx, force: true });
    expect(summary).toMatchObject({ sent: 0, duplicates: 2, failed: [] });
  });

  it('changes the key when the list changes', async () => {
    const before = (await runScheduleLint({ ...ctx, force: true })).digest;
    fetchMomenceEvents.mockResolvedValue([special(), event(), farOut()]);
    const after = (await runScheduleLint({ ...ctx, force: true })).digest;
    expect(after).not.toBe(before);
    expect(sendKeys()[2]).toContain(after as string);
  });

  it('records a failed send and carries on to the next admin', async () => {
    sendTemplate
      .mockRejectedValueOnce(new Error('resend down'))
      .mockResolvedValueOnce({ status: 'sent' });
    const summary = await runScheduleLint(ctx);
    expect(summary).toMatchObject({ sent: 1, failed: ['wes@pyre.test'] });
  });

  it('stops before the budget runs out and leaves the dirty flag for the next tick', async () => {
    let calls = 0;
    const tight = { ...ctx, timeRemainingMs: () => (calls++ === 0 ? 50_000 : 1_000) };
    const summary = await runScheduleLint(tight);
    expect(summary).toMatchObject({ sent: 1, outOfTime: true });
    expect(store.get(DIRTY_KEY)).toMatchObject({ reason: 'resume' });
    expect(store.has(DONE_KEY)).toBe(false);
  });

  it('skips when there is nobody to tell, and does not retry every hour', async () => {
    listStaff.mockResolvedValue([]);
    expect((await runScheduleLint(ctx)).skipped).toBe('no-admins');
    expect(store.get(DONE_KEY)).toBeTruthy();
  });

  it('surfaces a Momence outage as an error and leaves nothing marked done', async () => {
    fetchMomenceEvents.mockRejectedValue(new Error('Momence Events API returned 503'));
    await expect(runScheduleLint(ctx)).rejects.toThrow('503');
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(store.has(DONE_KEY)).toBe(false);
  });
});
