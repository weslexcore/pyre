import { beforeEach, describe, expect, it, vi } from 'vitest';
import { definitionSchema, journeyCampaign } from './schema';

const createCampaign = vi.fn();
vi.mock('@pyre/webhook-core', () => ({
  createCampaign: (...args: unknown[]) => createCampaign(...args),
  listCampaigns: vi.fn(async () => []),
}));
vi.mock('@/lib/campaigns/server', () => ({ LANDING_ORIGIN: 'https://pyresauna.com' }));

const { ensureJourneyCampaign } = await import('./campaign');

const base = {
  trigger: { type: 'manual' },
  steps: [{ key: 'a', timing: { anchor: 'previous', offsetHours: 1 }, content: { type: 'none' } }],
};

describe('journeyCampaign', () => {
  it('uses the linked campaign, else the journey id', () => {
    expect(journeyCampaign('win-back', { campaign: 'lapsed-customers' })).toBe('lapsed-customers');
    expect(journeyCampaign('win-back', {})).toBe('win-back');
  });

  it('only accepts a campaign slug', () => {
    expect(definitionSchema.safeParse({ ...base, campaign: 'lapsed-customers' }).success).toBe(
      true
    );
    expect(definitionSchema.safeParse({ ...base, campaign: 'Lapsed Customers' }).success).toBe(
      false
    );
  });
});

describe('ensureJourneyCampaign', () => {
  beforeEach(() => createCampaign.mockReset());

  it('creates an evergreen campaign named after the journey', async () => {
    createCampaign.mockResolvedValue({
      ok: true,
      campaign: { id: 'c1', slug: 'win-back', name: 'Win back', status: 'active' },
    });
    const result = await ensureJourneyCampaign(
      { id: 'win-back-30-days', name: 'Win back' },
      'a@b.c'
    );
    expect(result).toEqual({
      ok: true,
      created: true,
      campaign: { id: 'c1', slug: 'win-back', name: 'Win back', archived: false },
    });
    expect(createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Win back', type: 'evergreen', destinationKind: 'home' })
    );
  });

  it('links the existing campaign when one already has that name', async () => {
    createCampaign.mockResolvedValue({
      ok: false,
      reason: 'slug_taken',
      existing: { id: 'c9', slug: 'win-back', name: 'Win Back', status: 'active' },
    });
    const result = await ensureJourneyCampaign({ id: 'x', name: 'Win back' }, 'a@b.c');
    expect(result).toMatchObject({
      ok: true,
      created: false,
      campaign: { id: 'c9', slug: 'win-back' },
    });
  });
});
