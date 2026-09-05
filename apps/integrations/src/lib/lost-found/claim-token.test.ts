import { beforeAll, describe, expect, it } from 'vitest';
import { createClaimToken, verifyClaimToken } from './claim-token';

// The module reads its secret from import.meta.env at call time.
beforeAll(() => {
  (import.meta.env as Record<string, string>).UNSUBSCRIBE_SECRET = 'test-secret-for-claims';
});

const NOTICE_ID = '2f0a0c6e-0000-4000-8000-000000000000';

describe('claim tokens', () => {
  it('round-trips the notice it addresses', () => {
    const token = createClaimToken(NOTICE_ID);
    expect(token).toBeTruthy();
    expect(verifyClaimToken(token as string)).toBe(NOTICE_ID);
  });

  it('rejects a token whose payload was swapped for another notice', () => {
    const token = createClaimToken(NOTICE_ID) as string;
    const [, signature] = token.split('.');
    const forged = `${Buffer.from('11111111-0000-4000-8000-000000000000').toString('base64url')}.${signature}`;
    expect(verifyClaimToken(forged)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const token = createClaimToken(NOTICE_ID) as string;
    const [payload] = token.split('.');
    expect(verifyClaimToken(`${payload}.notasignature`)).toBeNull();
  });

  it('rejects malformed input rather than throwing', () => {
    expect(verifyClaimToken('')).toBeNull();
    expect(verifyClaimToken('nodot')).toBeNull();
    expect(verifyClaimToken('..')).toBeNull();
  });

  it("won't accept an unsubscribe token — the namespaces are separated", () => {
    // buildUnsubscribeUrl signs the bare payload; claims sign 'lost-found:<payload>'.
    const { createHmac } = require('node:crypto') as typeof import('node:crypto');
    const payload = Buffer.from(NOTICE_ID).toString('base64url');
    const unsubscribeStyle = createHmac('sha256', 'test-secret-for-claims')
      .update(payload)
      .digest('base64url');
    expect(verifyClaimToken(`${payload}.${unsubscribeStyle}`)).toBeNull();
  });
});
