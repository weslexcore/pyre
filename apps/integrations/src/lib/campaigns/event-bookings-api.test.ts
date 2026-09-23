import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), totals: vi.fn(), gate: vi.fn() }));
vi.mock('@pyre/webhook-core', () => ({ getRedis: () => ({ get: mocks.get, set: mocks.set }) }));
vi.mock('@/lib/auth/admin', () => ({ requirePage: mocks.gate }));
vi.mock('@/lib/momence/session-totals', () => ({ fetchSessionBookingTotals: mocks.totals }));

import { GET } from '@/pages/api/admin/event-bookings';

const request = (query: string) =>
  GET({
    cookies: {},
    url: new URL(`https://example.com/api/admin/event-bookings?${query}`),
  } as APIContext);
const totals = { bookings: 2, seats: 3, cancelled: 1, checkedIn: 1 };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.gate.mockResolvedValue({ user: {} });
  mocks.get.mockResolvedValue(null);
  mocks.totals.mockResolvedValue(totals);
});
describe('event bookings API', () => {
  it('combines selected slots and reads duplicate IDs once', async () => {
    const response = await request('events=1,2,1');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      bookings: 4,
      seats: 6,
      cancelled: 2,
      checkedIn: 2,
      sessions: [{ sessionId: '1' }, { sessionId: '2' }],
    });
    expect(mocks.totals).toHaveBeenCalledTimes(2);
  });
  it('keeps the single-event response compatible and uses cached session data', async () => {
    mocks.get.mockResolvedValue({ sessionId: '1', ...totals, generatedAt: '2026-09-23T12:00:00Z' });
    const response = await request('event=1');
    expect(await response.json()).toMatchObject({ sessionId: '1', ...totals, cached: true });
    expect(mocks.totals).not.toHaveBeenCalled();
  });
  it('refreshes every selected session and updates its cache', async () => {
    await request('events=1,2&fresh=1');
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.totals).toHaveBeenCalledTimes(2);
    expect(mocks.set).toHaveBeenCalledTimes(2);
  });
  it('does not return partial totals if a slot fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.totals.mockRejectedValueOnce(new Error('offline'));
    const response = await request('events=1,2');
    expect(response.status).toBe(502);
    expect(await response.json()).not.toHaveProperty('bookings');
    log.mockRestore();
  });
  it('rejects empty or invalid IDs before calling Momence', async () => {
    for (const query of [
      'events=',
      'events=1,abc',
      'event=0',
      `events=${Array(51).fill('1').join(',')}`,
    ]) {
      expect((await request(query)).status).toBe(400);
    }
    expect(mocks.totals).not.toHaveBeenCalled();
  });
  it('requires campaign access', async () => {
    mocks.gate.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await request('events=1')).status).toBe(403);
    expect(mocks.totals).not.toHaveBeenCalled();
  });
  it('limits simultaneous requests to four', async () => {
    let active = 0;
    let peak = 0;
    mocks.totals.mockImplementation(async () => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return totals;
    });
    await request('events=1,2,3,4,5,6');
    expect(peak).toBe(4);
    expect(mocks.totals).toHaveBeenCalledTimes(6);
  });
});
