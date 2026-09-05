import { describe, expect, it } from 'vitest';
import { DONATION_WINDOW_DAYS } from './types';
import { diffItemFields, normalizeItemPatch, normalizeItemSubmission } from './validate';

const HOUR_MS = 3_600_000;

describe('normalizeItemSubmission', () => {
  it('needs to know what the thing is', () => {
    expect(normalizeItemSubmission({ title: '   ' })).toMatchObject({ ok: false });
  });

  it('derives the donation deadline from found_at rather than the body', () => {
    const foundAt = '2026-09-01T18:00:00.000Z';
    const result = normalizeItemSubmission({
      title: 'Black water bottle',
      foundAt,
      // A crafted request must not be able to shorten the 30-day policy.
      donate_after: '2026-09-02T00:00:00.000Z',
      donateAfter: '2026-09-02T00:00:00.000Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Date.parse(result.value.donate_after)).toBe(
      Date.parse(foundAt) + DONATION_WINDOW_DAYS * 24 * HOUR_MS
    );
  });

  it('defaults the left-in window to the hours before it was found', () => {
    const foundAt = '2026-09-01T18:00:00.000Z';
    const result = normalizeItemSubmission({ title: 'Towel', foundAt });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Date.parse(result.value.left_window_start)).toBeLessThan(Date.parse(foundAt));
    expect(result.value.left_window_end).toBe(foundAt);
  });

  it('keeps the sessions staff picked, deduped and capped', () => {
    const result = normalizeItemSubmission({
      title: 'Towel',
      sessionIds: ['sess-1', 'sess-1', '  sess-2  ', '', 7, 'x'.repeat(65)],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.chosen_session_ids).toEqual(['sess-1', 'sess-2']);
  });

  it('takes no sessions at all — an item with a known owner has none', () => {
    const result = normalizeItemSubmission({ title: 'Towel' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.chosen_session_ids).toEqual([]);
  });

  it('rejects a window that runs backwards', () => {
    const result = normalizeItemSubmission({
      title: 'Towel',
      foundAt: '2026-09-01T18:00:00.000Z',
      leftWindowStart: '2026-09-01T17:00:00.000Z',
      leftWindowEnd: '2026-09-01T16:00:00.000Z',
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('refuses a window too wide to ask Momence about', () => {
    const result = normalizeItemSubmission({
      title: 'Towel',
      foundAt: '2026-09-10T18:00:00.000Z',
      leftWindowStart: '2026-09-01T00:00:00.000Z',
      leftWindowEnd: '2026-09-10T18:00:00.000Z',
    });
    expect(result).toMatchObject({ ok: false });
  });

  it("won't take an item found in the future", () => {
    const result = normalizeItemSubmission({
      title: 'Towel',
      foundAt: new Date(Date.now() + 48 * HOUR_MS).toISOString(),
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects an owner address that cannot be one', () => {
    const result = normalizeItemSubmission({ title: 'Ring', ownerEmail: 'not-an-address' });
    expect(result).toMatchObject({ ok: false });
  });

  it('lowercases the owner address it does accept', () => {
    const result = normalizeItemSubmission({ title: 'Ring', ownerEmail: '  Alex@Example.COM ' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.owner_email).toBe('alex@example.com');
  });

  it('rejects an unknown category rather than silently defaulting', () => {
    expect(normalizeItemSubmission({ title: 'Thing', category: 'spaceship' })).toMatchObject({
      ok: false,
    });
  });
});

describe('normalizeItemPatch', () => {
  it('ignores status — that moves through its own path, with its own audit line', () => {
    const result = normalizeItemPatch({ status: 'donated', title: 'Blue bottle' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toHaveProperty('status');
    expect(result.value.title).toBe('Blue bottle');
  });

  it('cannot reach the identity columns', () => {
    const result = normalizeItemPatch({
      title: 'Blue bottle',
      logged_by: 'someone@else.com',
      claimed_by_email: 'thief@example.com',
      donate_after: '2026-01-01T00:00:00.000Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value)).toEqual(['title']);
  });

  it('says so when there is nothing to change', () => {
    expect(normalizeItemPatch({})).toMatchObject({ ok: false });
  });

  it('clears the owner when handed an empty address', () => {
    const result = normalizeItemPatch({ ownerEmail: '' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.owner_email).toBeNull();
  });
});

describe('diffItemFields', () => {
  it('records only what actually moved', () => {
    const diff = diffItemFields(
      { title: 'Bottle', storage_location: 'Bin', description: null },
      { title: 'Bottle', storage_location: 'Shelf B' }
    );
    expect(diff).toEqual({ storage_location: { from: 'Bin', to: 'Shelf B' } });
  });

  it('treats undefined and null as the same absence', () => {
    expect(diffItemFields({ description: null }, { description: null })).toEqual({});
  });
});
