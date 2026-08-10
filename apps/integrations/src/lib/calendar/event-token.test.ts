// The token is the only gate on the public .ics endpoint, so forgery and
// malformed-payload handling get pinned here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CalendarTokenPayload, createCalendarToken, verifyCalendarToken } from './event-token';

const payload: CalendarTokenPayload = {
  v: 1,
  title: 'Signature Guided Class',
  start: '2026-06-20T14:00:00.000Z',
  end: '2026-06-20T16:00:00.000Z',
};

beforeEach(() => {
  vi.stubEnv('UNSUBSCRIBE_SECRET', 'test-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('calendar token', () => {
  it('round-trips a valid payload', () => {
    const token = createCalendarToken(payload);
    expect(token).toBeTruthy();
    expect(verifyCalendarToken(token as string)).toEqual(payload);
  });

  it('returns null without a signing secret', () => {
    vi.stubEnv('UNSUBSCRIBE_SECRET', '');
    vi.stubEnv('CRON_SECRET', '');
    expect(createCalendarToken(payload)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = createCalendarToken(payload) as string;
    const [, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, title: 'Evil Event' })).toString(
      'base64url'
    );
    expect(verifyCalendarToken(`${forged}.${sig}`)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const token = createCalendarToken(payload) as string;
    const [encoded] = token.split('.');
    expect(
      verifyCalendarToken(`${encoded}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)
    ).toBeNull();
  });

  it('rejects garbage and missing parts', () => {
    expect(verifyCalendarToken('not-a-token')).toBeNull();
    expect(verifyCalendarToken('')).toBeNull();
  });

  it('rejects an unsupported payload version', () => {
    const bad = createCalendarToken({ ...payload, v: 2 as unknown as 1 });
    expect(verifyCalendarToken(bad as string)).toBeNull();
  });

  it('rejects invalid or out-of-order dates and bad titles', () => {
    const make = (over: Partial<CalendarTokenPayload>) =>
      createCalendarToken({ ...payload, ...over }) as string;
    expect(verifyCalendarToken(make({ end: payload.start }))).toBeNull();
    expect(verifyCalendarToken(make({ end: '2026-06-20T13:00:00.000Z' }))).toBeNull();
    expect(verifyCalendarToken(make({ start: 'not-a-date' }))).toBeNull();
    expect(verifyCalendarToken(make({ title: '' }))).toBeNull();
    expect(verifyCalendarToken(make({ title: 'x'.repeat(201) }))).toBeNull();
  });
});
