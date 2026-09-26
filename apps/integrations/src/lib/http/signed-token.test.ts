import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { verifyCalendarToken } from '@/lib/calendar/event-token';
import { createUnsubscribeToken, verifyUnsubscribeToken } from '@/lib/email/unsubscribe-token';
import { verifyAskSessionToken } from '@/lib/knowledge/ask-token';
import { createClaimToken, verifyClaimToken } from '@/lib/lost-found/claim-token';
import { verifyDecisionToken } from '@/lib/partner/decision-token';
import { verifySubClaimToken } from '@/lib/schedule/sub-token';
import { signJson, signString, verifyJson, verifyString } from './signed-token';

// Tokens minted by each module's own HMAC code before it moved onto
// signed-token.ts (secrets below, clock at 2026-09-25T12:00Z). Links like
// these are already in inboxes; they must keep verifying.
const FIXTURES = {
  unsubscribe: 'Z3Vlc3RAZXhhbXBsZS5jb20.M8JHGrF0SEbR-9nmXOs6wYOdLAd2wtWLjfpnC48UZwA',
  claim:
    'MmYwYTBjNmUtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAw.O9UP25GoA75jHETUEuP63KCQS2OwLhRNqzETu3bqyd8',
  calendar:
    'eyJ2IjoxLCJ0aXRsZSI6IlNvY2lhbCBTYXVuYSIsInN0YXJ0IjoiMjAyNi0xMC0wMVQyMjowMDowMC4wMDBaIiwiZW5kIjoiMjAyNi0xMC0wMVQyMzozMDowMC4wMDBaIn0.b_934tOMntEvp6VNYJk-tL57PugRwEITBN9liYjD8eo',
  ask: 'eyJzaWQiOiJzZXNzXzEyMyIsImVtYWlsIjoic3RhZmZAcHlyZXNhdW5hLmNvbSIsImV4cCI6MTc5MDM4MDgwMDAwMH0.AG5nlqSO6xyKDCk73H1ZQKXtMZQFayJGcnoxj4zAZO0',
  decision:
    'eyJpZCI6InJlcS0xIiwiYWN0aW9uIjoiY29uZmlybSIsImV4cCI6MTc5MDk0MjQwMDAwMH0.L0EiBVybPIkk5ZsNqR8Tce3oUVs-GlFxxCGjfUz375A',
  sub: 'eyJpZCI6InN1Yi0xIiwic3RhZmZJZCI6InN0YWZmLTkiLCJleHAiOjE3OTA1OTY4MDAwMDB9.zBn8wfwktofm6OIv3QEeVY6rNaOwSUHONrehxvWW1Ec',
};

beforeAll(() => {
  const env = import.meta.env as Record<string, string>;
  env.UNSUBSCRIBE_SECRET = 'fixture-email-secret';
  env.EVE_CHANNEL_SECRET = 'fixture-eve-secret';
  env.PARTNER_LINK_SECRET = 'fixture-partner-secret';
  env.SCHEDULE_LINK_SECRET = 'fixture-schedule-secret';
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-25T12:00:00Z'));
});

afterAll(() => {
  vi.useRealTimers();
});

describe('tokens minted before the shared signer', () => {
  it('still verify, module by module', () => {
    expect(verifyUnsubscribeToken(FIXTURES.unsubscribe)).toBe('guest@example.com');
    expect(verifyClaimToken(FIXTURES.claim)).toBe('2f0a0c6e-0000-4000-8000-000000000000');
    expect(verifyCalendarToken(FIXTURES.calendar)).toEqual({
      v: 1,
      title: 'Social Sauna',
      start: '2026-10-01T22:00:00.000Z',
      end: '2026-10-01T23:30:00.000Z',
    });
    expect(verifyAskSessionToken(FIXTURES.ask, 'sess_123', 'staff@pyresauna.com')).toBe(true);
    expect(verifyDecisionToken(FIXTURES.decision)).toEqual({
      status: 'valid',
      requestId: 'req-1',
      action: 'confirm',
    });
    expect(verifySubClaimToken(FIXTURES.sub)).toEqual({
      status: 'valid',
      subRequestId: 'sub-1',
      staffId: 'staff-9',
    });
  });

  it('are re-minted byte-for-byte', () => {
    expect(createUnsubscribeToken('Guest@Example.com')).toBe(FIXTURES.unsubscribe);
    expect(createClaimToken('2f0a0c6e-0000-4000-8000-000000000000')).toBe(FIXTURES.claim);
  });
});

describe('signed-token core', () => {
  const opts = { secret: () => 's3cret' };

  it('round-trips strings and JSON', () => {
    expect(verifyString(signString('hello', opts) as string, opts)).toBe('hello');
    expect(verifyJson(signJson({ a: 1 }, opts) as string, opts)).toEqual({ a: 1 });
  });

  it('separates namespaces by key and message prefix', () => {
    const token = signString('x', opts) as string;
    expect(verifyString(token, { ...opts, keyPrefix: 'k:' })).toBeNull();
    expect(verifyString(token, { ...opts, messagePrefix: 'm:' })).toBeNull();
  });

  it('fails closed with no secret and on malformed input', () => {
    expect(signString('x', { secret: () => null })).toBeNull();
    expect(verifyString('', opts)).toBeNull();
    expect(verifyString('nodot', opts)).toBeNull();
    expect(verifyString('a.b', opts)).toBeNull();
  });
});
