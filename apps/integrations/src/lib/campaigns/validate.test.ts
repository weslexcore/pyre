import { describe, expect, it } from 'vitest';
import {
  FIELD_LIMITS,
  normalizeCampaignInput,
  normalizeCampaignPatch,
  normalizeLinkRequest,
} from './validate';

const ORIGIN = 'https://pyresauna.com';

const good = {
  name: 'Rest Fest 2026',
  type: 'event',
  destination: { kind: 'event', value: 'evt-1' },
  startsAt: '2026-09-01',
  endsAt: '2026-09-20',
  notes: 'Big one.',
};

describe('normalizeCampaignInput', () => {
  it('accepts a complete campaign and resolves the destination', () => {
    const result = normalizeCampaignInput(good, ORIGIN);
    expect(result).toEqual({
      ok: true,
      value: {
        name: 'Rest Fest 2026',
        type: 'event',
        destinationKind: 'event',
        destinationValue: 'evt-1',
        destinationUrl: 'https://pyresauna.com/events/evt-1',
        startsAt: '2026-09-01',
        endsAt: '2026-09-20',
        notes: 'Big one.',
        goals: [],
      },
    });
  });

  it('takes goals and drops none of them', () => {
    const result = normalizeCampaignInput(
      {
        ...good,
        goals: [
          { metric: 'bookings', target: 25 },
          { metric: 'clicks', target: '400' },
        ],
      },
      ORIGIN
    );
    expect(result.ok && result.value.goals).toEqual([
      { metric: 'bookings', target: 25 },
      { metric: 'clicks', target: 400 },
    ]);
  });

  it('refuses unknown metrics, repeats, and targets that are not whole counts', () => {
    const bad = (goals: unknown) => normalizeCampaignInput({ ...good, goals }, ORIGIN).ok;
    expect(bad([{ metric: 'vibes', target: 3 }])).toBe(false);
    expect(
      bad([
        { metric: 'bookings', target: 3 },
        { metric: 'bookings', target: 4 },
      ])
    ).toBe(false);
    expect(bad([{ metric: 'bookings', target: 0 }])).toBe(false);
    expect(bad([{ metric: 'bookings', target: -2 }])).toBe(false);
    expect(bad([{ metric: 'bookings', target: 2.5 }])).toBe(false);
    expect(bad([{ metric: 'bookings', target: 2_000_000 }])).toBe(false);
    expect(bad('twenty five')).toBe(false);
  });

  it('requires a name that slugifies to something', () => {
    expect(normalizeCampaignInput({ ...good, name: '' }, ORIGIN).ok).toBe(false);
    expect(normalizeCampaignInput({ ...good, name: '!!!' }, ORIGIN).ok).toBe(false);
  });

  it('caps the name at the shared limit', () => {
    const result = normalizeCampaignInput({ ...good, name: 'a'.repeat(500) }, ORIGIN);
    expect(result.ok && result.value.name.length).toBe(FIELD_LIMITS.name);
  });

  it('rejects unknown types', () => {
    expect(normalizeCampaignInput({ ...good, type: 'party' }, ORIGIN).ok).toBe(false);
    expect(normalizeCampaignInput({ ...good, type: 'newsletter' }, ORIGIN).ok).toBe(true);
  });

  it('needs an event id for event destinations', () => {
    const result = normalizeCampaignInput(
      { ...good, destination: { kind: 'event', value: '' } },
      ORIGIN
    );
    expect(result).toEqual({ ok: false, error: 'Pick an event' });
  });

  it('resolves a partner page and requires the partner', () => {
    const result = normalizeCampaignInput(
      { ...good, destination: { kind: 'partner', value: 'bft' } },
      ORIGIN
    );
    expect(result.ok && result.value.destinationUrl).toBe('https://pyresauna.com/bft');
    expect(result.ok && result.value.destinationValue).toBe('bft');
    expect(
      normalizeCampaignInput({ ...good, destination: { kind: 'partner', value: '' } }, ORIGIN)
    ).toEqual({ ok: false, error: 'Pick a partner' });
  });

  it('resolves the link tree page', () => {
    const result = normalizeCampaignInput(
      { ...good, destination: { kind: 'linktree', value: '' } },
      ORIGIN
    );
    expect(result.ok && result.value.destinationUrl).toBe('https://pyresauna.com/hi');
    expect(result.ok && result.value.destinationValue).toBe('');
  });

  it('drops the value for home and events destinations', () => {
    const result = normalizeCampaignInput(
      { ...good, destination: { kind: 'home', value: 'ignored' } },
      ORIGIN
    );
    expect(result.ok && result.value.destinationValue).toBe('');
    expect(result.ok && result.value.destinationUrl).toBe('https://pyresauna.com/');
  });

  it('rejects an end before the start and malformed dates', () => {
    expect(normalizeCampaignInput({ ...good, endsAt: '2026-08-01' }, ORIGIN).ok).toBe(false);
    expect(normalizeCampaignInput({ ...good, startsAt: '2026-02-31' }, ORIGIN).ok).toBe(false);
    expect(normalizeCampaignInput({ ...good, startsAt: 'yesterday' }, ORIGIN).ok).toBe(false);
  });

  it('allows open-ended dates', () => {
    const result = normalizeCampaignInput({ ...good, startsAt: '', endsAt: undefined }, ORIGIN);
    expect(result.ok && result.value.startsAt).toBe('');
    expect(result.ok && result.value.endsAt).toBe('');
  });
});

describe('normalizeCampaignPatch', () => {
  it('refuses to touch the slug', () => {
    expect(normalizeCampaignPatch({ slug: 'new-slug' }, ORIGIN)).toEqual({
      ok: false,
      error: 'slug_immutable',
    });
  });

  it('takes goals, and an empty list clears them', () => {
    expect(
      normalizeCampaignPatch({ goals: [{ metric: 'memberships', target: 5 }] }, ORIGIN)
    ).toEqual({ ok: true, value: { goals: [{ metric: 'memberships', target: 5 }] } });
    expect(normalizeCampaignPatch({ goals: [] }, ORIGIN)).toEqual({
      ok: true,
      value: { goals: [] },
    });
  });

  it('only includes the fields sent', () => {
    expect(normalizeCampaignPatch({ status: 'archived' }, ORIGIN)).toEqual({
      ok: true,
      value: { status: 'archived' },
    });
    expect(normalizeCampaignPatch({ status: 'paused' }, ORIGIN).ok).toBe(false);
  });

  it('re-resolves a changed destination', () => {
    const result = normalizeCampaignPatch(
      { destination: { kind: 'custom', value: 'eventbrite.com/e/9' } },
      ORIGIN
    );
    expect(result).toEqual({
      ok: true,
      value: {
        destinationKind: 'custom',
        destinationValue: 'eventbrite.com/e/9',
        destinationUrl: 'https://eventbrite.com/e/9',
      },
    });
  });
});

describe('normalizeLinkRequest', () => {
  it('rejects unknown placements', () => {
    expect(normalizeLinkRequest({ placementKey: 'tiktok' }, ORIGIN).ok).toBe(false);
  });

  it('accepts a standard placement with an optional variant', () => {
    const result = normalizeLinkRequest({ placementKey: 'instagram-bio', variant: ' v2 ' }, ORIGIN);
    expect(result.ok && result.value.placement.key).toBe('instagram-bio');
    expect(result.ok && result.value.variant).toBe('v2');
    expect(result.ok && result.value.destination).toBeNull();
  });

  it('caps the variant length', () => {
    const result = normalizeLinkRequest(
      { placementKey: 'instagram-bio', variant: 'x'.repeat(100) },
      ORIGIN
    );
    expect(result.ok && result.value.variant.length).toBe(FIELD_LIMITS.variant);
  });

  it('requires the partner name for partner share', () => {
    expect(normalizeLinkRequest({ placementKey: 'partner-share' }, ORIGIN)).toEqual({
      ok: false,
      error: 'Enter the partner name',
    });
    const result = normalizeLinkRequest(
      { placementKey: 'partner-share', sourceOverride: 'BFT' },
      ORIGIN
    );
    expect(result.ok && result.value.sourceOverride).toBe('BFT');
  });

  it('requires source and medium on the custom placement', () => {
    expect(
      normalizeLinkRequest({ placementKey: 'custom', custom: { source: 'x' } }, ORIGIN).ok
    ).toBe(false);
    const result = normalizeLinkRequest(
      { placementKey: 'custom', custom: { source: 'x', medium: 'y' } },
      ORIGIN
    );
    expect(result.ok && result.value.custom).toEqual({
      source: 'x',
      medium: 'y',
      content: '',
      term: '',
    });
  });

  it('resolves a per-link destination override', () => {
    const result = normalizeLinkRequest(
      { placementKey: 'sms-blast', destination: { kind: 'blog', value: 'why-sauna' } },
      ORIGIN
    );
    expect(result.ok && result.value.destination).toEqual({
      kind: 'blog',
      value: 'why-sauna',
      url: 'https://pyresauna.com/blog/why-sauna',
    });
  });
});
