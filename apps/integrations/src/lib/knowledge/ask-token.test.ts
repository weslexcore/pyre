import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAskSessionToken, verifyAskSessionToken } from './ask-token';

describe('ask session tokens', () => {
  const previous = process.env.EVE_CHANNEL_SECRET;

  beforeEach(() => {
    process.env.EVE_CHANNEL_SECRET = 'test-channel-secret';
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.EVE_CHANNEL_SECRET;
    else process.env.EVE_CHANNEL_SECRET = previous;
  });

  it('round-trips for the session and email it was minted for', () => {
    const token = createAskSessionToken('ses_123', 'sam@pyresauna.com');
    expect(token).toBeTruthy();
    expect(verifyAskSessionToken(token as string, 'ses_123', 'sam@pyresauna.com')).toBe(true);
  });

  it('rejects another session, another person, or a tampered signature', () => {
    const token = createAskSessionToken('ses_123', 'sam@pyresauna.com') as string;
    expect(verifyAskSessionToken(token, 'ses_999', 'sam@pyresauna.com')).toBe(false);
    expect(verifyAskSessionToken(token, 'ses_123', 'alex@pyresauna.com')).toBe(false);
    expect(verifyAskSessionToken(`${token}x`, 'ses_123', 'sam@pyresauna.com')).toBe(false);
    expect(verifyAskSessionToken('garbage', 'ses_123', 'sam@pyresauna.com')).toBe(false);
  });

  it('cannot be minted or verified without the channel secret', () => {
    delete process.env.EVE_CHANNEL_SECRET;
    expect(createAskSessionToken('ses_123', 'sam@pyresauna.com')).toBeNull();
    expect(verifyAskSessionToken('a.b', 'ses_123', 'sam@pyresauna.com')).toBe(false);
  });
});
