// Reading a campaign back out of Redis.
//
// Upstash parses every hash value as JSON on the way out, so a field whose
// text looks like a number returns as a number. Event destinations are Momence
// ids, so they are exactly that shape: dropping them left the edit form with an
// empty event and a "Pick an event" preview on a campaign that had one.
import { normalizeCampaignRecord, normalizeLinkRecord } from '@pyre/webhook-core';
import { describe, expect, it } from 'vitest';

/**
 * What @upstash/redis does to each field in an `hgetall` response
 * (pkg/commands/hgetall.ts): a safe-integer numeric string is JSON.parsed into
 * a number; anything larger is left as text.
 */
function asUpstashReads(stored: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stored)) {
    try {
      const asNumber = Number(value);
      const unsafe = !Number.isNaN(asNumber) && !Number.isSafeInteger(asNumber);
      out[key] = unsafe ? value : JSON.parse(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

const STORED = {
  id: 'c-1',
  name: 'Rest Fest',
  slug: 'rest-fest',
  type: 'event',
  status: 'active',
  destinationKind: 'event',
  destinationValue: '142261211',
  destinationUrl: 'https://www.pyresauna.com/events/142261211',
  startsAt: '2026-09-01',
  endsAt: '2026-09-30',
  notes: '',
  goals: '[]',
  createdAt: '1757000000000',
  createdBy: 'marina@pyresauna.com',
  updatedAt: '1757000000000',
};

describe('normalizeCampaignRecord', () => {
  it('keeps the event id Upstash hands back as a number', () => {
    const raw = asUpstashReads(STORED);
    // Guard the premise: this is a number by the time it reaches us.
    expect(typeof raw.destinationValue).toBe('number');

    const campaign = normalizeCampaignRecord(raw);
    expect(campaign?.destinationValue).toBe('142261211');
    expect(campaign?.destinationKind).toBe('event');
  });

  it('keeps a name that is only digits', () => {
    const campaign = normalizeCampaignRecord(asUpstashReads({ ...STORED, name: '2026' }));
    expect(campaign?.name).toBe('2026');
  });

  it('still reads plain text fields unchanged', () => {
    const campaign = normalizeCampaignRecord(asUpstashReads(STORED));
    expect(campaign?.slug).toBe('rest-fest');
    expect(campaign?.destinationUrl).toBe('https://www.pyresauna.com/events/142261211');
    expect(campaign?.createdAt).toBe(1757000000000);
  });

  it('drops a field that is neither text nor a number', () => {
    const campaign = normalizeCampaignRecord({ ...asUpstashReads(STORED), notes: { a: 1 } });
    expect(campaign?.notes).toBe('');
  });
});

describe('normalizeLinkRecord', () => {
  it('keeps numeric-looking link fields', () => {
    const link = normalizeLinkRecord(
      asUpstashReads({
        id: 'l-1',
        campaignId: 'c-1',
        label: '',
        url: 'https://www.pyresauna.com/events/142261211',
        destination: 'event:142261211',
        source: 'instagram',
        medium: 'social',
        campaign: 'rest-fest',
        term: '',
        content: '2',
        placementKey: 'bio',
        variant: '2',
        shortCode: '2026',
      })
    );
    expect(link?.content).toBe('2');
    expect(link?.variant).toBe('2');
    expect(link?.shortCode).toBe('2026');
  });
});
