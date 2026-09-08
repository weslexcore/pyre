import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionConflictReviewRow } from '@/lib/db';
import { fakeDb } from './fake-db';
import type { SessionConflict } from './types';

const fetchHostSessions = vi.fn();
const cancelHostSession = vi.fn();
const cancelRouteStatus = vi.fn();

vi.mock('@/lib/momence/host-api', () => ({
  fetchHostSessions: (args: unknown) => fetchHostSessions(args),
  cancelHostSession: (id: number) => cancelHostSession(id),
  cancelRouteStatus: () => cancelRouteStatus(),
}));

const { cancelSelectedSessions } = await import('./cancel');

const et = (date: string, time: string): string =>
  new Date(`${date}T${time}:00-04:00`).toISOString();

const group = (eventId: number, sessionIds: number[]): SessionConflict => ({
  specialEvent: {
    id: eventId,
    title: `Event ${eventId}`,
    startsAt: et('2026-09-17', '19:00'),
    endsAt: et('2026-09-17', '21:00'),
    location: null,
    link: null,
  },
  sessions: sessionIds.map((id) => ({
    id,
    title: `Slot ${id}`,
    tag: 'Open Hours',
    type: 'open hours',
    startsAt: et('2026-09-17', '19:00'),
    endsAt: et('2026-09-17', '20:00'),
    location: null,
    bookingCount: 1,
    capacity: 10,
    link: null,
    preselected: true,
  })),
});

const review = (over: Partial<SessionConflictReviewRow> = {}): SessionConflictReviewRow => ({
  id: 'r1',
  week_start: '2026-09-14',
  horizon_start: '2026-09-14',
  horizon_end: '2026-10-12',
  status: 'pending',
  source: 'cron',
  conflicts: [group(1, [10, 11]), group(2, [11, 12])],
  session_count: 3,
  resolution: {},
  notified_at: null,
  notified_count: 0,
  resolved_at: null,
  resolved_by: null,
  checked_at: '2026-09-14T12:00:00Z',
  created_by: 'cron',
  created_at: '2026-09-14T12:00:00Z',
  updated_at: '2026-09-14T12:00:00Z',
  ...over,
});

describe('cancelSelectedSessions', () => {
  beforeEach(() => {
    fetchHostSessions.mockReset().mockResolvedValue([{ id: 10 }, { id: 11 }, { id: 12 }]);
    cancelHostSession
      .mockReset()
      .mockResolvedValue({ outcome: 'cancelled', via: 'POST /host/sessions/{id}/cancel' });
    cancelRouteStatus.mockReset().mockReturnValue('supported');
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('cancels the selected sessions, skips the rest, and closes the review', async () => {
    const row = review();
    const { db } = fakeDb([row as never]);
    const result = await cancelSelectedSessions(db as never, row, [10, 11], 'wes@pyre.test');

    expect(cancelHostSession.mock.calls.map(([id]) => id)).toEqual([10, 11]);
    expect(result.outcomes).toMatchObject({
      '10': { outcome: 'cancelled', via: 'POST /host/sessions/{id}/cancel', by: 'wes@pyre.test' },
      '11': { outcome: 'cancelled' },
      '12': { outcome: 'skipped', message: 'Left in place' },
    });
    expect(result.review?.status).toBe('resolved');
    expect(result.review?.resolved_by).toBe('wes@pyre.test');
    expect(result.cancelSupport).toBe('supported');
    // Liveness was checked over the review's own horizon.
    expect(fetchHostSessions).toHaveBeenCalledWith({
      startAfter: '2026-09-14T04:00:00.000Z',
      startBefore: '2026-10-13T04:00:00.000Z',
    });
  });

  it('marks a session already gone from Momence as cleared without calling cancel', async () => {
    fetchHostSessions.mockResolvedValue([{ id: 11 }, { id: 12 }]);
    const row = review();
    const { db } = fakeDb([row as never]);
    const result = await cancelSelectedSessions(db as never, row, [10, 11, 12], 'wes');
    expect(result.outcomes['10']).toMatchObject({ outcome: 'cleared' });
    expect(cancelHostSession).not.toHaveBeenCalledWith(10);
    expect(result.review?.status).toBe('resolved');
  });

  it('records a refusal as failed and keeps the review open', async () => {
    cancelHostSession
      .mockResolvedValueOnce({ outcome: 'error', status: 409, message: 'has bookings' })
      .mockResolvedValue({ outcome: 'cancelled', via: 'DELETE /host/sessions/{id}' });
    const row = review();
    const { db } = fakeDb([row as never]);
    const result = await cancelSelectedSessions(db as never, row, [10, 11, 12], 'wes');
    expect(result.outcomes['10']).toMatchObject({
      outcome: 'failed',
      message: 'Momence 409: has bookings',
    });
    expect(result.review?.status).toBe('pending');
  });

  it('surfaces a missing cancel API per session and as cancelSupport', async () => {
    cancelHostSession.mockResolvedValue({ outcome: 'unsupported', tried: ['POST x'] });
    cancelRouteStatus.mockReturnValue('unsupported');
    const row = review();
    const { db } = fakeDb([row as never]);
    const result = await cancelSelectedSessions(db as never, row, [10], 'wes');
    expect(result.outcomes['10'].outcome).toBe('unsupported');
    expect(result.outcomes['10'].message).toContain('Momence dashboard');
    expect(result.cancelSupport).toBe('unsupported');
    expect(result.review?.status).toBe('pending');
  });

  it('leaves already-handled sessions alone and lets a failed one be retried', async () => {
    const row = review({
      resolution: {
        '10': { outcome: 'cancelled', at: 'x', by: 'y' },
        '11': { outcome: 'failed', at: 'x', by: 'y', message: '500' },
      },
    });
    const { db } = fakeDb([row as never]);
    // Retrying 11 only; 12 is undecided and not selected, so it is skipped.
    const result = await cancelSelectedSessions(db as never, row, [11], 'wes');
    expect(cancelHostSession.mock.calls.map(([id]) => id)).toEqual([11]);
    expect(result.outcomes).toEqual({
      '11': expect.objectContaining({ outcome: 'cancelled' }),
      '12': expect.objectContaining({ outcome: 'skipped' }),
    });
    expect(result.review?.status).toBe('resolved');
  });

  it('keeps an earlier failure when it is not selected this time', async () => {
    const row = review({ resolution: { '10': { outcome: 'failed', at: 'x', by: 'y' } } });
    const { db } = fakeDb([row as never]);
    const result = await cancelSelectedSessions(db as never, row, [11, 12], 'wes');
    expect(result.outcomes['10']).toBeUndefined();
    expect(result.review?.status).toBe('pending');
  });

  it('stops when the budget runs out and leaves the rest undecided', async () => {
    const row = review();
    const { db } = fakeDb([row as never]);
    let calls = 0;
    const budget = () => (calls++ === 0 ? 50_000 : 1_000);
    const result = await cancelSelectedSessions(db as never, row, [10, 11, 12], 'wes', budget);
    expect(result.outOfTime).toBe(true);
    expect(Object.keys(result.outcomes)).toEqual(['10']);
    expect(result.review?.status).toBe('pending');
  });

  it('returns no review when it was closed underneath us', async () => {
    const row = review();
    const { db } = fakeDb([{ ...row, status: 'resolved' } as never]);
    const result = await cancelSelectedSessions(db as never, row, [10], 'wes');
    expect(result.review).toBeNull();
  });
});
